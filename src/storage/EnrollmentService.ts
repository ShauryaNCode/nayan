import {ADMIN_KEY_VERSION, ADMIN_PUBLIC_KEY_PEM} from '../crypto/AdminKey';
import {EmbeddingCrypto} from '../crypto/EmbeddingCrypto';
import {NativeSecureKey} from '../crypto/NativeSecureKey';
import {wrapDEKWithAdminPublicKey} from '../crypto/RSAOAEP';
import {getDeviceId} from '../sync/device/DeviceId';
import {getDatabase} from './database/DatabaseManager';
import {executeSql} from './database/SQLiteCompat';
import {LedgerService} from './LedgerService';
import {LSHIndex} from './LSHIndex';
import {
  bytesToHex,
  float32ToBase64,
} from '../utils/BufferUtils';

export type EnrollmentParams = {
  personnelId: string;
  name: string;
  department: string;
  embedding: Float32Array;
  consentTs: number;
  locationTag?: string;
};

let lastZeroedDEKSnapshotForTests: number[] | null = null;

async function randomBytes(byteLength: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(byteLength);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  const nativeModule = NativeSecureKey.getNativeModuleForTests();
  if (typeof nativeModule.generateSecureRandomBase64 === 'function') {
    const {base64ToBytes} = await import('../utils/BufferUtils');
    const generated = base64ToBytes(
      await nativeModule.generateSecureRandomBase64(byteLength),
    );
    if (generated.byteLength !== byteLength) {
      generated.fill(0);
      throw new Error(
        `[EnrollmentService] Native random returned ${generated.byteLength} bytes, expected ${byteLength}.`,
      );
    }
    bytes.set(generated);
    generated.fill(0);
    return bytes;
  }

  throw new Error(
    '[EnrollmentService] crypto.getRandomValues is unavailable and native secure random is missing.',
  );
}

function assertEnrollmentParams(params: EnrollmentParams): void {
  if (!params.personnelId.trim()) {
    throw new Error('[EnrollmentService] personnelId is required.');
  }
  if (!params.name.trim()) {
    throw new Error('[EnrollmentService] name is required.');
  }
  if (!params.department.trim()) {
    throw new Error('[EnrollmentService] department is required.');
  }
  if (params.embedding.length !== 128) {
    throw new Error(
      `[EnrollmentService] Expected 128 embedding floats, got ${params.embedding.length}.`,
    );
  }
  if (!Number.isFinite(params.consentTs) || params.consentTs <= 0) {
    throw new Error('[EnrollmentService] consentTs must be a Unix timestamp in ms.');
  }
}

async function executeEnrollmentTransaction(params: {
  personnelId: string;
  name: string;
  department: string;
  embedding: Float32Array;
  dekHex: string;
  kekHwWrapped: string;
  kekAdminWrapped: string;
  enrollmentTs: number;
  consentTs: number;
}): Promise<void> {
  const db = getDatabase();
  const isoNow = new Date(params.enrollmentTs).toISOString();
  const consentLogId = `${params.personnelId}:consent:${params.consentTs}`;

  try {
    executeSql(db, 'BEGIN IMMEDIATE;');
    executeSql(db, 'PRAGMA defer_foreign_keys=ON;');

    await LSHIndex.indexEmbedding({
      personnelId: params.personnelId,
      embedding: params.embedding,
      db,
    });

    const embeddingBase64 = float32ToBase64(params.embedding);
    const encryptedEmbed = await EmbeddingCrypto.encrypt(
      embeddingBase64,
      params.personnelId,
      params.dekHex,
    );

    executeSql(
      db,
      `
        INSERT INTO personnel (
          personnel_id,
          full_name,
          role,
          encrypted_embed,
          kek_hw_wrapped,
          kek_admin_wrapped,
          admin_key_version,
          enrollment_ts,
          consent_ts,
          enrollment_status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?);
      `,
      [
        params.personnelId,
        params.name,
        params.department,
        encryptedEmbed,
        params.kekHwWrapped,
        params.kekAdminWrapped,
        ADMIN_KEY_VERSION,
        params.enrollmentTs,
        params.consentTs,
        isoNow,
        isoNow,
      ],
    );
    executeSql(
      db,
      `
        INSERT INTO consent_log (
          id,
          personnel_id,
          consent_ts,
          consent_ver,
          created_at
        ) VALUES (?, ?, ?, 1, ?);
      `,
      [consentLogId, params.personnelId, params.consentTs, isoNow],
    );
    executeSql(db, 'COMMIT;');
  } catch (error) {
    try {
      executeSql(db, 'ROLLBACK;');
    } catch (_) {
      // Preserve the original database error.
    }
    throw error;
  }
}

export const EnrollmentService = {
  async enroll(params: EnrollmentParams): Promise<void> {
    assertEnrollmentParams(params);

    const dek = await randomBytes(32);
    let dekHex = bytesToHex(dek);
    let personKeyCreated = false;

    console.debug('[EnrollmentService] DEK allocated for enrollment encryption.');

    try {
      await NativeSecureKey.generatePersonKey(params.personnelId);
      personKeyCreated = true;

      const kekHwWrapped = await NativeSecureKey.wrapDEK(
        params.personnelId,
        dekHex,
      );
      const kekAdminWrapped = await wrapDEKWithAdminPublicKey(
        dek,
        ADMIN_PUBLIC_KEY_PEM,
      );

      await executeEnrollmentTransaction({
        personnelId: params.personnelId,
        name: params.name,
        department: params.department,
        embedding: params.embedding,
        dekHex,
        kekHwWrapped,
        kekAdminWrapped,
        enrollmentTs: Date.now(),
        consentTs: params.consentTs,
      });

      dek.fill(0);
      lastZeroedDEKSnapshotForTests = Array.from(dek);
      dekHex = ''.padStart(64, '0');
      console.debug('[EnrollmentService] DEK zeroed after embedding encryption.');
    } catch (error) {
      dek.fill(0);
      lastZeroedDEKSnapshotForTests = Array.from(dek);
      dekHex = ''.padStart(64, '0');
      void dekHex;

      if (personKeyCreated) {
        try {
          await NativeSecureKey.deletePersonKey(params.personnelId);
        } catch (_) {
          // Avoid masking the enrollment failure; Phase 3 will audit deletions.
        }
      }

      throw error;
    }

    try {
      await LedgerService.recordEvent({
        personnelId: params.personnelId,
        eventType: 'ENROLLMENT',
        deviceId: await getDeviceId(),
        locationTag: params.locationTag,
      });
    } catch (error) {
      console.warn(
        '[EnrollmentService] Enrollment committed, but ledger append failed.',
        error,
      );
    }
  },

  getLastZeroedDEKSnapshotForTests(): number[] | null {
    // JS can only prove that this Uint8Array was overwritten. Full memory
    // forensics still requires a native memory profiler.
    return lastZeroedDEKSnapshotForTests;
  },
};
