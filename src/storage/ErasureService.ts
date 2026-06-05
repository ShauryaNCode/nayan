import NetInfo from '@react-native-community/netinfo';
import {MMKV} from 'react-native-mmkv';
import type {DB} from '@op-engineering/op-sqlite';

import {EmbeddingCrypto} from '../crypto/EmbeddingCrypto';
import {NativeSecureKey} from '../crypto/NativeSecureKey';
import {SHA256} from '../crypto/SHA256';
import {buildAndSignReceipt, type DeletionReceipt} from '../services/deviceKey';
import {uploadDeletionReceipt} from '../services/uploadDeletionReceipt';
import {base64ToBytes, utf8FromBytes} from '../utils/BufferUtils';
import {uuid_v4} from '../utils/uuid';
import {getDatabase} from './database/DatabaseManager';
import {executeSql, getFirstRow, getRows} from './database/SQLiteCompat';
import {LedgerService} from './LedgerService';

export type ErasureRequest = {
  personnelId: string;
  confirmedName: string;
  requestedBy: string;
  requestedAt: number;
  commandNonce?: string;
};

export type ErasureResult = {
  personnelId: string;
  softPurgeComplete: boolean;
  hardPurgeComplete: boolean;
  ledgerEventId: string;
  requestedAt: number;
  executedAt: number;
};

export type ErasureRequestResult =
  | {status: 'EXECUTED'; result: ErasureResult}
  | {status: 'QUEUED'; queuedAt: number};

export const ERASURE_MMKV_ID = 'nayan.m3.erasure.v1';
export const PENDING_ERASURES_KEY = 'm3_pending_erasures';
export const PENDING_RECEIPTS_KEY = 'pending_receipts';
export const ORPHAN_KEYS_KEY = 'm3_orphan_keys';

type PersonRow = {
  id?: string;
  name?: string;
  kek_hw_wrapped?: string;
  [index: number]: unknown;
};

type LedgerPayloadRow = {
  ledger_id?: string;
  encrypted_payload?: string;
  [index: number]: unknown;
};

const storage = new MMKV({id: ERASURE_MMKV_ID});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readString(
  row: Record<string | number, unknown> | undefined,
  namedColumn: string,
  index: number,
): string | undefined {
  const value = row?.[namedColumn] ?? row?.[index];
  return typeof value === 'string' ? value : undefined;
}

function assertErasureRequest(request: ErasureRequest): void {
  if (!request.personnelId.trim()) {
    throw new Error('[ErasureService] personnelId is required.');
  }
  if (!request.confirmedName.trim()) {
    throw new Error('[ErasureService] confirmedName is required.');
  }
  if (!request.requestedBy.trim()) {
    throw new Error('[ErasureService] requestedBy is required.');
  }
  if (!Number.isFinite(request.requestedAt) || request.requestedAt <= 0) {
    throw new Error('[ErasureService] requestedAt must be a Unix timestamp in ms.');
  }
}

function parseJsonArray<T>(key: string): T[] {
  const rawValue = storage.getString(key);
  if (rawValue == null) {
    return [];
  }

  const parsed = JSON.parse(rawValue) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`[ErasureService] MMKV key ${key} is not an array.`);
  }
  return parsed as T[];
}

function writeJsonArray<T>(key: string, values: T[]): void {
  storage.set(key, JSON.stringify(values));
}

function resolveCommandNonce(request: ErasureRequest): string {
  const commandNonce = request.commandNonce?.trim();
  return commandNonce && commandNonce.length > 0 ? commandNonce : uuid_v4();
}

function queuePendingReceipt(receipt: DeletionReceipt): void {
  const queue = parseJsonArray<DeletionReceipt>(PENDING_RECEIPTS_KEY);
  queue.push(receipt);
  writeJsonArray(PENDING_RECEIPTS_KEY, queue);
}

function fetchPerson(db: DB, personnelId: string): PersonRow | undefined {
  const result = executeSql(
    db,
    `
      SELECT
        personnel_id AS id,
        full_name AS name,
        kek_hw_wrapped
      FROM personnel
      WHERE personnel_id = ?
      LIMIT 1;
    `,
    [personnelId],
  );
  return getFirstRow(result) as PersonRow | undefined;
}

async function ensureLedgerPayloadHashes(
  db: DB,
  personnelId: string,
  kekHwWrapped?: string,
): Promise<void> {
  const result = executeSql(
    db,
    `
      SELECT ledger_id, encrypted_payload
      FROM attendance_ledger
      WHERE personnel_id = ?
        AND event_counter IS NOT NULL
        AND encrypted_payload IS NOT NULL
        AND (payload_hash IS NULL OR payload_hash = '');
    `,
    [personnelId],
  );
  const rows = getRows(result) as LedgerPayloadRow[];
  if (rows.length === 0) {
    return;
  }

  if (!kekHwWrapped) {
    throw new Error('Missing wrapped DEK for ledger payload hash backfill.');
  }

  let dekHex = await NativeSecureKey.unwrapDEK(personnelId, kekHwWrapped);
  try {
    for (const row of rows) {
      const ledgerId = readString(row, 'ledger_id', 0);
      const encryptedPayload = readString(row, 'encrypted_payload', 1);
      if (!ledgerId || !encryptedPayload) {
        throw new Error('Ledger row is missing payload fields.');
      }

      const payloadBase64 = await EmbeddingCrypto.decrypt(
        encryptedPayload,
        personnelId,
        dekHex,
      );
      const payloadJson = utf8FromBytes(base64ToBytes(payloadBase64));
      executeSql(
        db,
        `
          UPDATE attendance_ledger
          SET payload_hash = ?
          WHERE ledger_id = ?;
        `,
        [SHA256.digest(payloadJson), ledgerId],
      );
    }
  } finally {
    dekHex = ''.padStart(64, '0');
    void dekHex;
  }
}

async function execute(request: ErasureRequest): Promise<ErasureResult> {
  assertErasureRequest(request);

  const db = getDatabase();
  const person = fetchPerson(db, request.personnelId);

  if (!person) {
    throw new Error(`PERSON_NOT_FOUND: ${request.personnelId}`);
  }

  const personName = person.name ?? (person[1] as string | undefined);
  if (personName !== request.confirmedName) {
    throw new Error(
      `NAME_MISMATCH: expected "${personName}", got "${request.confirmedName}"`,
    );
  }

  let transactionOpen = false;
  let purgePhase: 'soft' | 'hard' | 'commit' = 'soft';

  try {
    executeSql(db, 'BEGIN TRANSACTION;');
    transactionOpen = true;

    await ensureLedgerPayloadHashes(
      db,
      request.personnelId,
      person.kek_hw_wrapped ?? (person[2] as string | undefined),
    );

    executeSql(
      db,
      `
        UPDATE attendance_ledger
        SET consent_withdrawn = 1, personnel_id = NULL
        WHERE personnel_id = ?;
      `,
      [request.personnelId],
    );
    executeSql(
      db,
      `
        DELETE FROM lsh_index
        WHERE personnel_id = ?;
      `,
      [request.personnelId],
    );
    executeSql(
      db,
      `
        DELETE FROM consent_log
        WHERE personnel_id = ?;
      `,
      [request.personnelId],
    );
    executeSql(
      db,
      `
        DELETE FROM personnel
        WHERE personnel_id = ?;
      `,
      [request.personnelId],
    );

    purgePhase = 'hard';
    await NativeSecureKey.destroyPersonKey(request.personnelId);

    purgePhase = 'commit';
    executeSql(db, 'COMMIT;');
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try {
        executeSql(db, 'ROLLBACK;');
      } catch (_) {
        // Preserve the purge error; rollback may fail if COMMIT already closed.
      }
    }

    const reason = getErrorMessage(error);
    if (purgePhase === 'hard') {
      throw new Error(`HARD_PURGE_FAILED: ${reason}`);
    }
    throw new Error(`SOFT_PURGE_FAILED: ${reason}`);
  }

  const commandNonce = resolveCommandNonce(request);
  const receipt = await buildAndSignReceipt(request.personnelId, commandNonce);
  try {
    await uploadDeletionReceipt(receipt);
  } catch (_error) {
    queuePendingReceipt(receipt);
  }

  const personnelIdHash = SHA256.digest(request.personnelId);
  const ledgerResult = await LedgerService.recordEvent({
    personnelId: personnelIdHash,
    eventType: 'ERASURE',
    deviceId: request.requestedBy,
    locationTag: `ERASURE:${request.requestedBy}:${request.requestedAt}`,
  });

  return {
    personnelId: request.personnelId,
    softPurgeComplete: true,
    hardPurgeComplete: true,
    ledgerEventId: ledgerResult.ledgerId,
    requestedAt: request.requestedAt,
    executedAt: Date.now(),
  };
}

function queueOfflineErasure(request: ErasureRequest): void {
  assertErasureRequest(request);
  const queue = parseJsonArray<ErasureRequest>(PENDING_ERASURES_KEY);
  queue.push(request);
  writeJsonArray(PENDING_ERASURES_KEY, queue);
}

async function drainOfflineQueue(): Promise<{
  executed: ErasureResult[];
  failed: Array<{request: ErasureRequest; error: string}>;
}> {
  const queue = parseJsonArray<ErasureRequest>(PENDING_ERASURES_KEY);
  const executed: ErasureResult[] = [];
  const failed: Array<{request: ErasureRequest; error: string}> = [];
  const remaining: ErasureRequest[] = [];

  for (const request of queue) {
    try {
      executed.push(await execute(request));
    } catch (error) {
      failed.push({request, error: getErrorMessage(error)});
      remaining.push(request);
    }
  }

  writeJsonArray(PENDING_ERASURES_KEY, remaining);
  return {executed, failed};
}

async function drainPendingReceipts(): Promise<{
  uploaded: number;
  failed: Array<{receipt: DeletionReceipt; error: string}>;
}> {
  const queue = parseJsonArray<DeletionReceipt>(PENDING_RECEIPTS_KEY);
  let uploaded = 0;
  const failed: Array<{receipt: DeletionReceipt; error: string}> = [];
  const remaining: DeletionReceipt[] = [];

  for (const receipt of queue) {
    try {
      await uploadDeletionReceipt(receipt);
      uploaded += 1;
    } catch (error) {
      failed.push({receipt, error: getErrorMessage(error)});
      remaining.push(receipt);
    }
  }

  writeJsonArray(PENDING_RECEIPTS_KEY, remaining);
  return {uploaded, failed};
}

async function requestErasure(
  request: ErasureRequest,
): Promise<ErasureRequestResult> {
  const netState = await NetInfo.fetch();
  if (netState.isConnected) {
    const result = await execute(request);
    return {status: 'EXECUTED', result};
  }

  queueOfflineErasure(request);
  return {status: 'QUEUED', queuedAt: Date.now()};
}

export const ErasureService = {
  execute,
  queueOfflineErasure,
  drainOfflineQueue,
  drainPendingReceipts,
  requestErasure,
};
