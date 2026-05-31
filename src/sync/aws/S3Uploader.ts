import { S3Client } from '@aws-sdk/client-s3';

let s3ClientInstance: S3Client | null = null;

export const getS3Client = (): S3Client => {
  if (!s3ClientInstance) {
    s3ClientInstance = new S3Client({
      region: 'us-east-1', // Default region, configure as needed
      // Credentials will be injected via provider in Phase 1
    });
  }
  return s3ClientInstance;
};
