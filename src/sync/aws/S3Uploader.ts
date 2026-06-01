/**
 * S3Uploader.ts
 * Path: src/sync/aws/S3Uploader.ts
 *
 * Phase 0 / Phase 1 scope:
 *   - getS3Client()  : singleton S3Client (SDK v3, no real calls yet).
 *   - uploadStub()   : mock upload – logs attempt, returns success object.
 *
 * Real multipart upload, credential injection, and retry wiring
 * are Phase 2 concerns.
 */

import { S3Client } from '@aws-sdk/client-s3';

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
// uploadStub (Phase 1)
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
