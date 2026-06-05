/**
 * SyncWorker.ts
 * Path: src/sync/aws/SyncWorker.ts
 *
 * Integrated Phase 2/3 Sequential Queue Execution & Main Branch Ledger Verification
 */

import { getDelay } from '../connectivity/BackoffEngine';
import { LedgerService, type VerifyChainResult } from '../../storage/LedgerService';
import { WALCheckpointScheduler } from '../../storage/WALCheckpointScheduler';
import {
  readNext,
  updateStatus,
  incrementAttempts,
  type QueueItem,
} from '../queue/OfflineQueueReader';
import { uploadStub, type UploadStubResult } from './S3Uploader';

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

export type SyncWorkerResult =
  | {
      success: true;
      uploaded: false;
      chain: VerifyChainResult;
    }
  | {
      success: true;
      uploaded: true;
      item: QueueItem;
      upload: UploadStubResult;
      chain: VerifyChainResult;
    }
  | {
      success: false;
      reason: 'chain_integrity';
      chain: VerifyChainResult;
    }
  | {
      success: false;
      reason: 'upload_failed';
      item: QueueItem;
      chain: VerifyChainResult;
      error: unknown;
    };

const MAX_RETRIES = 5;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Integrated Engine Implementation
// ---------------------------------------------------------------------------

/**
 * Handles uploading a single item with exponential backoff retries,
 * respecting the strict Ledger Integrity constraints from main.
 */
async function uploadWithRetry(item: QueueItem, chain: VerifyChainResult): Promise<SyncWorkerResult> {
  let currentAttempt = item.attempts;

  while (currentAttempt <= MAX_RETRIES) {
    console.log(`[SyncWorker] Attempt ${currentAttempt}/${MAX_RETRIES} for item "${item.id}"`);

    try {
      // Use main's expected uploader signature
      const upload = uploadStub(item.payload);
      
      // Update DB state
      updateStatus(item.id, 'DONE');
      item.status = 'DONE';
      WALCheckpointScheduler.runNow();

      return { success: true, uploaded: true, item, upload, chain };
    } catch (error) {
      console.warn(`[SyncWorker] Attempt ${currentAttempt} failed:`, error);

      if (currentAttempt >= MAX_RETRIES) {
        updateStatus(item.id, 'FAILED');
        item.status = 'FAILED';

        const postFailureChain = await LedgerService.verifyChain();
        if (!postFailureChain.ok) {
          console.warn('[CHAIN INTEGRITY VIOLATION]', JSON.stringify(postFailureChain.brokenAt));
        }
        return {
          success: false,
          reason: 'upload_failed',
          item,
          chain: postFailureChain,
          error,
        };
      }

      // Calculate and execute backoff sleep delay
      const delayMs = getDelay(currentAttempt);
      await sleep(delayMs);

      // Mutate local state and persist backthrough db layer
      currentAttempt = incrementAttempts(item.id);
      if (currentAttempt < 0) {
        return {
          success: false,
          reason: 'upload_failed',
          item,
          chain,
          error: new Error('Item vanished from local persistence during retry step.'),
        };
      }
    }
  }

  return { success: false, reason: 'upload_failed', item, chain, error: new Error('Retries exhausted') };
}

// ---------------------------------------------------------------------------
// Public API Surface
// ---------------------------------------------------------------------------

/**
 * Single item processor preserving main's exact interface footprint
 * but upgrading it internally to feature backoffs.
 */
export async function syncNextQueuedItem(): Promise<SyncWorkerResult> {
  const chain = await LedgerService.verifyChain();
  if (!chain.ok) {
    console.warn('[CHAIN INTEGRITY VIOLATION]', JSON.stringify(chain.brokenAt));
    return { success: false, reason: 'chain_integrity', chain };
  }

  const item = readNext();
  if (!item) {
    return { success: true, uploaded: false, chain };
  }

  return uploadWithRetry(item, chain);
}

/**
 * Optional sequential loop runner from Phase 2 scope. 
 * Kept if other sections of your phase branch call processQueue() directly.
 */
export async function processQueue(): Promise<{ processed: number; succeeded: number; failed: number }> {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  while (true) {
    const result = await syncNextQueuedItem();
    if (!result.success && result.reason === 'chain_integrity') {
      break;
    }
    if (result.success && !result.uploaded) {
      // No items left in queue
      break;
    }

    processed++;
    if (result.success) {
      succeeded++;
    } else {
      failed++;
    }
  }

  return { processed, succeeded, failed };
}
