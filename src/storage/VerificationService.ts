import {EmbeddingCrypto} from '../crypto/EmbeddingCrypto';
import {NativeSecureKey} from '../crypto/NativeSecureKey';
import {base64ToFloat32} from '../utils/BufferUtils';
import {getDatabase} from './database/DatabaseManager';

type PersonnelEmbeddingRow = {
  kek_hw_wrapped?: string;
  encrypted_embed?: string;
  [index: number]: unknown;
};

function getFirstRow(rows: unknown): PersonnelEmbeddingRow | undefined {
  if (Array.isArray(rows)) {
    return rows[0] as PersonnelEmbeddingRow | undefined;
  }

  if (
    rows &&
    typeof rows === 'object' &&
    '_array' in rows &&
    Array.isArray((rows as {_array?: unknown})._array)
  ) {
    return (rows as {_array: PersonnelEmbeddingRow[]})._array[0];
  }

  if (
    rows &&
    typeof rows === 'object' &&
    'item' in rows &&
    typeof (rows as {item?: unknown}).item === 'function'
  ) {
    return (rows as {item: (index: number) => PersonnelEmbeddingRow | undefined}).item(0);
  }

  return undefined;
}

export const VerificationService = {
  async decryptEmbedding(personnelId: string): Promise<Float32Array> {
    if (!personnelId.trim()) {
      throw new Error('[VerificationService] personnelId is required.');
    }

    const db = getDatabase();
    const result = db.executeSync(
      `
        SELECT kek_hw_wrapped, encrypted_embed
        FROM personnel
        WHERE personnel_id = ?
          AND enrollment_status = 'active'
        LIMIT 1;
      `,
      [personnelId],
    );
    const row = getFirstRow(result.rows);

    const kekHwWrapped = row?.kek_hw_wrapped ?? (row?.[0] as string | undefined);
    const encryptedEmbed =
      row?.encrypted_embed ?? (row?.[1] as string | undefined);

    if (!kekHwWrapped || !encryptedEmbed) {
      throw new Error(
        `[VerificationService] No encrypted embedding found for ${personnelId}.`,
      );
    }

    let dekHex = await NativeSecureKey.unwrapDEK(personnelId, kekHwWrapped);
    try {
      const plaintextBase64 = await EmbeddingCrypto.decrypt(
        encryptedEmbed,
        personnelId,
        dekHex,
      );
      return base64ToFloat32(plaintextBase64);
    } finally {
      // JS strings are immutable, so this narrows lifetime but cannot overwrite
      // the original string backing store. Do not cache DEKs in JS memory.
      dekHex = ''.padStart(64, '0');
      void dekHex;
    }
  },
};
