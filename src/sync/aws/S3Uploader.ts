/**
 * S3Uploader.ts
 * Path: src/sync/aws/S3Uploader.ts
 *
 * Phase 0 / Phase 1 scope (preserved, unchanged):
 *   - getS3Client()  : singleton S3Client (SDK v3).
 *   - uploadStub()   : mock upload – logs attempt, returns success object.
 *
 * Phase 2 additions:
 *   - UploadResult   : typed result shape for real uploads.
 *   - uploadToS3()   : real PutObjectCommand upload using AWS SDK v3.
 *                      Serialises the QueueItem payload as JSON.
 *                      Returns a typed success/failure UploadResult.
 *
 * Multipart uploads, pre-signed URLs, and credential injection
 * are Phase 3 concerns.
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { QueueItem } from '../queue/OfflineQueueReader';

// ---------------------------------------------------------------------------
// S3 Client singleton (Phase 0 – unchanged)
// ---------------------------------------------------------------------------

let s3ClientInstance: S3Client | null = null;

/** Returns the shared S3Client instance, creating it on first call. */
export const getS3Client = (): S3Client => {
  if (!s3ClientInstance) {
    s3ClientInstance = new S3Client({
      region: 'us-east-1', // Default region, configure as needed
      // Credentials will be injected via provider in Phase 1
    });
  }
  return s3ClientInstance;
};

// ---------------------------------------------------------------------------
// uploadStub (Phase 1 – preserved, unchanged)
// ---------------------------------------------------------------------------

export interface UploadStubResult {
  /** Simulated S3 ETag for the uploaded object. */
  eTag: string;
  /** Simulated S3 key the payload would have been stored under. */
  key: string;
  /** ISO-8601 timestamp of the mock upload. */
  uploadedAt: string;
  /** Always true for the stub. */
  success: boolean;
}

/**
 * Stub upload function for Phase 1.
 *
 * Logs the upload attempt and returns a mock success response.
 * No real AWS API calls are made.
 *
 * @param payload - The data record to "upload" (any serialisable object).
 * @returns A mock UploadStubResult confirming success.
 */
export const uploadStub = (
  payload: Record<string, unknown>,
): UploadStubResult => {
  const key = `stub/${Date.now()}-${Math.random().toString(36).slice(2)}.json`;

  console.log(
    `[S3Uploader] uploadStub: upload attempt for key "${key}".`,
    '\nPayload:', JSON.stringify(payload),
  );

  const result: UploadStubResult = {
    eTag: `"stub-etag-${Date.now()}"`,
    key,
    uploadedAt: new Date().toISOString(),
    success: true,
  };

  console.log('[S3Uploader] uploadStub: mock upload succeeded.', result);

  return result;
};

// ---------------------------------------------------------------------------
// uploadToS3 (Phase 2)
// ---------------------------------------------------------------------------

/** S3 bucket name.  Override via env/config in Phase 3. */
const S3_BUCKET = 'nayan-offline-sync';

/** S3 key prefix for queued sync records. */
const S3_KEY_PREFIX = 'sync/events';

/**
 * Typed result returned by uploadToS3().
 */
export interface UploadResult {
  /** Whether the upload succeeded. */
  success: boolean;
  /**
   * S3 key the object was stored under.
   * Populated on success and on failure (to aid debugging).
   */
  key: string;
  /** S3 ETag of the stored object.  Only present on success. */
  eTag?: string;
  /** ISO-8601 timestamp of the upload attempt. */
  uploadedAt: string;
  /** Error message. Only present on failure. */
  error?: string;
}

/**
 * Uploads a single QueueItem to S3 using PutObjectCommand (SDK v3).
 *
 * The entire QueueItem (id, payload, enqueuedAt, status, attempts) is
 * serialised as UTF-8 JSON and stored as an S3 object.
 *
 * Key format: sync/events/<itemId>.json
 *
 * No multipart uploads – single PutObject only (Phase 2 scope).
 *
 * @param queueItem - The QueueItem to upload.
 * @returns A promise that resolves to an UploadResult describing
 *          success or failure.  This function never rejects.
 */
export const uploadToS3 = async (queueItem: QueueItem): Promise<UploadResult> => {
  const key = `${S3_KEY_PREFIX}/${queueItem.id}.json`;
  const uploadedAt = new Date().toISOString();

  const body = JSON.stringify({
    id: queueItem.id,
    payload: queueItem.payload,
    enqueuedAt: queueItem.enqueuedAt,
    status: queueItem.status,
    attempts: queueItem.attempts,
    uploadedAt,
  });

  console.log(
    `[S3Uploader] uploadToS3: uploading item "${queueItem.id}" → s3://${S3_BUCKET}/${key}`,
  );

  try {
    const client = getS3Client();

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    });

    const response = await client.send(command);

    const result: UploadResult = {
      success: true,
      key,
      eTag: response.ETag,
      uploadedAt,
    };

    console.log(
      `[S3Uploader] uploadToS3: item "${queueItem.id}" uploaded successfully.`,
      `ETag=${result.eTag}`,
    );

    return result;
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : String(err);

    console.error(
      `[S3Uploader] uploadToS3: item "${queueItem.id}" failed.`,
      errorMessage,
    );

    return {
      success: false,
      key,
      uploadedAt,
      error: errorMessage,
    };
  }
};
