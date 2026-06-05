import {EmbeddingCrypto} from '../crypto/EmbeddingCrypto';
import {NativeSecureKey} from '../crypto/NativeSecureKey';
import {SHA256} from '../crypto/SHA256';
import {NativeUptimeClock} from '../native/NativeUptimeClock';
import {
  base64ToBytes,
  bytesToBase64,
  utf8FromBytes,
  utf8ToBytes,
} from '../utils/BufferUtils';
import {CanonicalJSON} from '../utils/canonicalJSON';
import {uuid_v4} from '../utils/uuid';
import {getDatabase} from './database/DatabaseManager';
import {executeSql, getFirstRow, getRows} from './database/SQLiteCompat';
import {EventCounter} from './EventCounter';

export type LedgerEventType =
  | 'ENROLLMENT'
  | 'VERIFICATION'
  | 'REJECTION'
  | 'ERASURE';

export type RecordEventParams = {
  personnelId: string;
  eventType: LedgerEventType;
  matchScore?: number;
  deviceId: string;
  locationTag?: string;
};

export type VerifyChainResult = {
  ok: boolean;
  totalRecords: number;
  brokenAt?: {
    index: number;
    ledgerId: string;
    event_counter: number;
  };
};

type PersonnelKeyRow = {
  kek_hw_wrapped?: string;
  [index: number]: unknown;
};

type LedgerRow = {
  id?: string;
  personnel_id?: string;
  payload_json?: string;
  encrypted_payload?: string;
  payload_hash?: string;
  prev_hash?: string;
  current_hash?: string;
  ts?: number;
  uptime_ms?: number;
  event_counter?: number;
  consent_withdrawn?: number;
  event_type?: string;
  [index: number]: unknown;
};

const GENESIS_HASH = '0'.repeat(64);
const LEGACY_EVENT_TYPE = 'verification';
const REDACTED_PAYLOAD_MARKER = '{"encrypted":true}';

let recordEventQueue: Promise<unknown> = Promise.resolve();

function assertRecordEventParams(params: RecordEventParams): void {
  if (!params.personnelId.trim()) {
    throw new Error('[LedgerService] personnelId is required.');
  }
  if (!params.deviceId.trim()) {
    throw new Error('[LedgerService] deviceId is required.');
  }
  if (
    params.matchScore !== undefined &&
    (!Number.isFinite(params.matchScore) ||
      params.matchScore < 0 ||
      params.matchScore > 1)
  ) {
    throw new Error('[LedgerService] matchScore must be between 0 and 1.');
  }
}

function readString(
  row: ({[key: string]: unknown; [index: number]: unknown}) | undefined,
  namedColumn: string,
  index: number,
): string | undefined {
  const value = row?.[namedColumn] ?? row?.[index];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(
  row: ({[key: string]: unknown; [index: number]: unknown}) | undefined,
  namedColumn: string,
  index: number,
): number | undefined {
  const value = row?.[namedColumn] ?? row?.[index];
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function getWrappedDEK(personnelId: string): string {
  const db = getDatabase();
  const result = executeSql(
    db,
    `
      SELECT kek_hw_wrapped
      FROM personnel
      WHERE personnel_id = ?
        AND enrollment_status = 'active'
      LIMIT 1;
    `,
    [personnelId],
  );
  const row = getFirstRow(result) as PersonnelKeyRow | undefined;
  const wrappedDEK = row?.kek_hw_wrapped ?? (row?.[0] as string | undefined);

  if (!wrappedDEK) {
    throw new Error(`[LedgerService] No wrapped DEK found for ${personnelId}.`);
  }

  return wrappedDEK;
}

async function unwrapLedgerDEK(
  personnelId: string,
  dekCache?: Map<string, string>,
): Promise<string> {
  const cached = dekCache?.get(personnelId);
  if (cached) {
    return cached;
  }

  const wrappedDEK = getWrappedDEK(personnelId);
  const dekHex = await NativeSecureKey.unwrapDEK(personnelId, wrappedDEK);
  if (dekCache) {
    dekCache.set(personnelId, dekHex);
  }
  return dekHex;
}

async function encryptLedgerPayload(
  payloadJson: string,
  personnelId: string,
): Promise<string> {
  let dekHex = await unwrapLedgerDEK(personnelId);
  const plaintextBase64 = bytesToBase64(utf8ToBytes(payloadJson));

  try {
    return await EmbeddingCrypto.encrypt(plaintextBase64, personnelId, dekHex);
  } finally {
    // JS strings are immutable; this bounds accidental reuse but cannot wipe the
    // original backing store. Never cache DEKs in normal ledger writes.
    dekHex = ''.padStart(64, '0');
    void dekHex;
  }
}

async function decryptLedgerPayload(
  encryptedPayloadBase64: string,
  personnelId: string,
  dekCache?: Map<string, string>,
): Promise<string> {
  const dekHex = await unwrapLedgerDEK(personnelId, dekCache);
  const plaintextBase64 = await EmbeddingCrypto.decrypt(
    encryptedPayloadBase64,
    personnelId,
    dekHex,
  );
  return utf8FromBytes(base64ToBytes(plaintextBase64));
}

function fetchPreviousHash(): string {
  const db = getDatabase();
  const result = executeSql(
    db,
    `
      SELECT current_hash
      FROM attendance_ledger
      WHERE event_counter IS NOT NULL
      ORDER BY event_counter DESC
      LIMIT 1;
    `,
  );
  const row = getFirstRow(result);
  return readString(row, 'current_hash', 0) ?? GENESIS_HASH;
}

function insertLedgerRows(params: {
  ledgerId: string;
  personnelId: string;
  databaseEventType: string;
  deviceId: string;
  matchScore: number | null;
  encryptedPayload: string | null;
  payloadHash: string;
  prevHash: string;
  currentHash: string;
  ts: number;
  uptimeMs: number;
  eventCounter: number;
  sessionHash: string;
}): void {
  const db = getDatabase();
  const capturedAt = new Date(params.ts).toISOString();

  try {
    executeSql(db, 'BEGIN IMMEDIATE;');
    executeSql(
      db,
      `
        INSERT INTO attendance_ledger (
          ledger_id,
          id,
          personnel_id,
          event_type,
          captured_at,
          device_id,
          confidence,
          liveness_score,
          payload_json,
          payload_hash,
          encrypted_payload,
          previous_hash,
          prev_hash,
          current_hash,
          chain_index,
          ts,
          uptime_ms,
          event_counter,
          synced,
          consent_withdrawn,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?);
      `,
      [
        params.ledgerId,
        params.ledgerId,
        params.personnelId,
        params.databaseEventType,
        capturedAt,
        params.deviceId,
        params.matchScore,
        REDACTED_PAYLOAD_MARKER,
        params.payloadHash,
        params.encryptedPayload,
        params.prevHash,
        params.prevHash,
        params.currentHash,
        params.eventCounter,
        params.ts,
        params.uptimeMs,
        params.eventCounter,
        capturedAt,
      ],
    );
    executeSql(
      db,
      `
        INSERT INTO boot_session_anchors (
          wall_ts,
          uptime_ms,
          event_id,
          session_hash
        ) VALUES (?, ?, ?, ?);
      `,
      [params.ts, params.uptimeMs, params.ledgerId, params.sessionHash],
    );
    executeSql(db, 'COMMIT;');
  } catch (error) {
    try {
      executeSql(db, 'ROLLBACK;');
    } catch (_) {
      // Preserve the original transaction failure.
    }
    throw error;
  }
}

async function recordEventInternal(
  params: RecordEventParams,
): Promise<{ledgerId: string; currentHash: string}> {
  assertRecordEventParams(params);

  const ts = Date.now();
  const uptimeMs = await NativeUptimeClock.getUptimeMs();
  const eventCounter = EventCounter.getNext();
  const ledgerId = uuid_v4();
  const payload = {
    device_id: params.deviceId,
    event_counter: eventCounter,
    event_type: params.eventType,
    location_tag: params.locationTag ?? null,
    match_score: params.matchScore ?? null,
    personnel_id: params.personnelId,
    ts,
  };

  const prevHash = fetchPreviousHash();
  const canonicalPayload = CanonicalJSON.stringify(payload);
  const payloadHash = SHA256.digest(canonicalPayload);
  const currentHash = SHA256.digest(
    [
      prevHash,
      payloadHash,
      String(ts),
      String(uptimeMs),
      String(eventCounter),
    ].join('|'),
  );
  const sessionHash = SHA256.digest(`${ts}|${uptimeMs}|${ledgerId}`);
  const encryptedPayload =
    params.eventType === 'ERASURE'
      ? null
      : await encryptLedgerPayload(canonicalPayload, params.personnelId);

  insertLedgerRows({
    ledgerId,
    personnelId: params.personnelId,
    databaseEventType:
      params.eventType === 'ERASURE' ? 'erasure' : LEGACY_EVENT_TYPE,
    deviceId: params.deviceId,
    matchScore: params.matchScore ?? null,
    encryptedPayload,
    payloadHash,
    prevHash,
    currentHash,
    ts,
    uptimeMs,
    eventCounter,
    sessionHash,
  });

  return {ledgerId, currentHash};
}

export async function recordEvent(
  params: RecordEventParams,
): Promise<{ledgerId: string; currentHash: string}> {
  const next = recordEventQueue.then(
    () => recordEventInternal(params),
    () => recordEventInternal(params),
  );
  recordEventQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export const insertLedgerEvent = recordEvent;

function buildBrokenResult(
  rows: LedgerRow[],
  index: number,
  row: LedgerRow,
): VerifyChainResult {
  return {
    ok: false,
    totalRecords: rows.length,
    brokenAt: {
      index,
      ledgerId: String(row.id ?? row[0] ?? ''),
      event_counter: Number(row.event_counter ?? row[9] ?? 0),
    },
  };
}

export async function verifyChain(): Promise<VerifyChainResult> {
  const db = getDatabase();
  const result = executeSql(
    db,
    `
      SELECT
        ledger_id AS id,
        personnel_id,
        payload_json,
        encrypted_payload,
        payload_hash,
        COALESCE(prev_hash, previous_hash) AS prev_hash,
        current_hash,
        ts,
        uptime_ms,
        event_counter,
        consent_withdrawn,
        event_type
      FROM attendance_ledger
      WHERE event_counter IS NOT NULL
      ORDER BY event_counter ASC;
    `,
  );
  const rows = getRows(result) as LedgerRow[];
  const dekCache = new Map<string, string>();
  let prevHash = GENESIS_HASH;
  let expectedEventCounter = 1;
  let previousTs: number | null = null;

  try {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const personnelId = readString(row, 'personnel_id', 1);
      const payloadJson = readString(row, 'payload_json', 2);
      const encryptedPayload = readString(row, 'encrypted_payload', 3);
      const payloadHash = readString(row, 'payload_hash', 4);
      const rowPrevHash = readString(row, 'prev_hash', 5);
      const currentHash = readString(row, 'current_hash', 6);
      const ts = readNumber(row, 'ts', 7);
      const uptimeMs = readNumber(row, 'uptime_ms', 8);
      const eventCounter = readNumber(row, 'event_counter', 9);
      const eventType = readString(row, 'event_type', 11);

      if (
        !rowPrevHash ||
        !currentHash ||
        ts === undefined ||
        uptimeMs === undefined ||
        eventCounter === undefined ||
        !Number.isInteger(eventCounter) ||
        eventCounter !== expectedEventCounter ||
        (previousTs !== null && ts < previousTs) ||
        rowPrevHash !== prevHash
      ) {
        return buildBrokenResult(rows, i, row);
      }

      let hashInput: string;
      if (payloadHash) {
        hashInput = payloadHash;
        if (personnelId && encryptedPayload) {
          try {
            const payloadJson = await decryptLedgerPayload(
              encryptedPayload,
              personnelId,
              dekCache,
            );
            if (SHA256.digest(payloadJson) !== payloadHash) {
              return buildBrokenResult(rows, i, row);
            }
          } catch (_) {
            return buildBrokenResult(rows, i, row);
          }
        } else if (
          payloadJson &&
          payloadJson !== REDACTED_PAYLOAD_MARKER &&
          eventType?.toLowerCase() !== 'erasure'
        ) {
          if (SHA256.digest(payloadJson) !== payloadHash) {
            return buildBrokenResult(rows, i, row);
          }
        }
      } else {
        if (!personnelId || !encryptedPayload) {
          return buildBrokenResult(rows, i, row);
        }

        try {
          const payloadJson = await decryptLedgerPayload(
            encryptedPayload,
            personnelId,
            dekCache,
          );
          const payload = JSON.parse(payloadJson) as Record<string, unknown>;
          hashInput = CanonicalJSON.stringify(payload);
        } catch (_) {
          return buildBrokenResult(rows, i, row);
        }
      }

      const expected = SHA256.digest(
        [
          prevHash,
          hashInput,
          String(ts),
          String(uptimeMs),
          String(eventCounter),
        ].join('|'),
      );

      if (expected !== currentHash) {
        return buildBrokenResult(rows, i, row);
      }

      prevHash = currentHash;
      previousTs = ts;
      expectedEventCounter = eventCounter + 1;
    }
  } finally {
    for (const personnelId of dekCache.keys()) {
      dekCache.set(personnelId, ''.padStart(64, '0'));
    }
    dekCache.clear();
  }

  return {ok: true, totalRecords: rows.length};
}

export async function recordVerificationEvent(params: {
  personnelId: string;
  matchScore: number;
  accepted: boolean;
  deviceId: string;
}): Promise<void> {
  await recordEvent({
    personnelId: params.personnelId,
    eventType: params.accepted ? 'VERIFICATION' : 'REJECTION',
    matchScore: params.matchScore,
    deviceId: params.deviceId,
  });
}

export const LedgerService = {
  insertLedgerEvent,
  recordEvent,
  recordVerificationEvent,
  verifyChain,
};
