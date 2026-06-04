'use strict';

/**
 * Lambda Authorizer – Pre-signed S3 URL Generator
 * Path: deploy/aws/lambda/authorizer/index.js
 *
 * Validates device authentication tokens and generates pre-signed S3 URLs
 * for multipart upload of attendance data batches.
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const BUCKET_NAME = process.env.ATTENDANCE_BUCKET_NAME || 'nayan-attendance-sync';
const PRESIGN_EXPIRES_IN = 300; // 5 minutes

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Validates the device token from the Authorization header.
 * @param {string} token - Bearer token from the device.
 * @returns {boolean} Whether the token is valid.
 */
function validateDeviceToken(token) {
  if (!token || !token.startsWith('Bearer ')) {
    return false;
  }
  // NOTE: Replace with real JWT/HMAC validation in production.
  const jwt = token.replace('Bearer ', '');
  return jwt.length > 16;
}

/**
 * Lambda handler – generates a pre-signed PUT URL for attendance batch upload.
 * @param {import('aws-lambda').APIGatewayProxyEvent} event
 * @returns {Promise<import('aws-lambda').APIGatewayProxyResult>}
 */
exports.handler = async (event) => {
  try {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;

    if (!validateDeviceToken(authHeader)) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Unauthorized: invalid or missing device token' }),
      };
    }

    const deviceId = event.queryStringParameters?.deviceId;
    if (!deviceId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required query parameter: deviceId' }),
      };
    }

    const objectKey = `attendance/${deviceId}/${Date.now()}.ndjson`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: objectKey,
      ContentType: 'application/x-ndjson',
      ServerSideEncryption: 'AES256',
    });

    const presignedUrl = await getSignedUrl(s3, command, {
      expiresIn: PRESIGN_EXPIRES_IN,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadUrl: presignedUrl,
        objectKey,
        expiresIn: PRESIGN_EXPIRES_IN,
      }),
    };
  } catch (error) {
    console.error('[Authorizer] Error generating pre-signed URL:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
