import {complianceEndpoint} from '../config/api';
import type {DeletionReceipt} from './deviceKey';

export type ReceiptUploadResult = {
  success: true;
};

export async function uploadDeletionReceipt(
  receipt: DeletionReceipt,
): Promise<ReceiptUploadResult> {
  const response = await postReceipt(receipt);

  if (response.status === 200) {
    return {success: true};
  }

  throw new Error(`RECEIPT_UPLOAD_FAILED_STATUS_${response.status}`);
}

async function postReceipt(receipt: DeletionReceipt): Promise<Response> {
  if (!receipt.signature?.trim()) {
    throw new Error('RECEIPT_SIGNATURE_MISSING');
  }

  const endpoint = complianceEndpoint('/compliance/deletion-receipt');

  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(receipt),
    });
  } catch (_error) {
    throw new Error('RECEIPT_UPLOAD_FAILED');
  }
}
