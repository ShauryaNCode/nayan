import {LedgerService, type VerifyChainResult} from '../../storage/LedgerService';
import {readNext, type QueueItem} from '../queue/OfflineQueueReader';
import {uploadStub, type UploadStubResult} from './S3Uploader';

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

export async function syncNextQueuedItem(): Promise<SyncWorkerResult> {
  const chain = await LedgerService.verifyChain();
  if (!chain.ok) {
    console.warn('[CHAIN INTEGRITY VIOLATION]', JSON.stringify(chain.brokenAt));
    return {success: false, reason: 'chain_integrity', chain};
  }

  const item = readNext();
  if (!item) {
    return {success: true, uploaded: false, chain};
  }

  try {
    const upload = uploadStub(item.payload);
    item.status = 'DONE';
    return {success: true, uploaded: true, item, upload, chain};
  } catch (error) {
    item.status = 'FAILED';
    const postFailureChain = await LedgerService.verifyChain();
    if (!postFailureChain.ok) {
      console.warn(
        '[CHAIN INTEGRITY VIOLATION]',
        JSON.stringify(postFailureChain.brokenAt),
      );
    }
    return {
      success: false,
      reason: 'upload_failed',
      item,
      chain: postFailureChain,
      error,
    };
  }
}
