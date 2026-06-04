'use strict';

/**
 * Lambda Sync Handler – NDJSON Attendance Batch Receiver
 * Path: deploy/aws/lambda/sync-handler/index.js
 *
 * Receives NDJSON attendance batches from mobile devices, validates records,
 * writes to S3, and returns ACK / 409 conflict / 500 error responses.
 */

const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');

const BUCKET_NAME = process.env.ATTENDANCE_BUCKET_NAME || 'nayan-attendance-sync';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Parses and validates NDJSON body.
 * @param {string} body - Raw NDJSON string.
 * @returns {{ records: object[], errors: string[] }}
 */
function parseNDJSON(body) {
  const records = [];
  const errors = [];

  if (!body) {
    return { records, errors: ['Empty request body'] };
  }

  const lines = body.trim().split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const record = JSON.parse(line);
      if (!record.userId || !record.timestamp || !record.eventType) {
        errors.push(`Line ${i + 1}: missing required fields (userId, timestamp, eventType)`);
      } else {
        records.push(record);
      }
    } catch {
      errors.push(`Line ${i + 1}: invalid JSON`);
    }
  }

  return { records, errors };
}

/**
 * Checks whether an object key already exists in S3 (deduplication).
 * @param {string} key - S3 object key.
 * @returns {Promise<boolean>}
 */
async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Lambda handler – receives, validates, and stores attendance batch.
 * @param {import('aws-lambda').APIGatewayProxyEvent} event
 * @returns {Promise<import('aws-lambda').APIGatewayProxyResult>}
 */
exports.handler = async (event) => {
  try {
    const { records, errors } = parseNDJSON(event.body || '');

    if (errors.length > 0 && records.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid NDJSON payload', details: errors }),
      };
    }

    const deviceId = event.queryStringParameters?.deviceId || 'unknown';
    const batchId = uuidv4();
    const objectKey = `attendance/${deviceId}/${batchId}.ndjson`;

    // Conflict detection – check for duplicate batch key
    const exists = await objectExists(objectKey);
    if (exists) {
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Conflict: batch already uploaded', batchId }),
      };
    }

    const ndjsonBody = records.map((r) => JSON.stringify(r)).join('\n');

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: objectKey,
        Body: ndjsonBody,
        ContentType: 'application/x-ndjson',
        ServerSideEncryption: 'AES256',
        Metadata: {
          deviceId,
          batchId,
          recordCount: String(records.length),
        },
      }),
    );

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ack: true,
        batchId,
        objectKey,
        recordCount: records.length,
        validationErrors: errors,
      }),
    };
  } catch (error) {
    console.error('[SyncHandler] Error processing batch:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
