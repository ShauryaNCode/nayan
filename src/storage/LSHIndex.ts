import type {DB} from '@op-engineering/op-sqlite';

import {
  LSH_BANDS,
  LSH_DIMS,
  LSH_PLANES_PER_BAND,
} from '../crypto/LSHHyperplanes';
import {LSHModule} from '../crypto/LSHModule';
import {float32ToBase64} from '../utils/BufferUtils';
import {getDatabase} from './database/DatabaseManager';
import {executeSql, getRows} from './database/SQLiteCompat';
import {VerificationService} from './VerificationService';

export type LSHCandidate = {
  personnelId: string;
  embedding: Float32Array;
};

type LshBandColumn = 'hash_band' | 'band_index';

type LshSchema = {
  bandColumn: LshBandColumn;
  hasSignature: boolean;
  hasUpdatedAt: boolean;
};

const BUCKET_KEY_PATTERN = /^(\d+)_(\d+)$/;
const MAX_BUCKET_VALUE = (1 << LSH_PLANES_PER_BAND) - 1;

let cachedSchema: LshSchema | null = null;

function assertPersonnelId(personnelId: string): void {
  if (!personnelId.trim()) {
    throw new Error('[LSHIndex] personnelId is required.');
  }
}

function assertL2Normalised(embedding: Float32Array, label: string): void {
  if (embedding.length !== LSH_DIMS) {
    throw new Error(
      `[LSHIndex] Expected ${LSH_DIMS} ${label} floats, got ${embedding.length}.`,
    );
  }

  const norm = Math.sqrt(
    embedding.reduce((sum, value) => {
      if (!Number.isFinite(value)) {
        throw new Error(`[LSHIndex] ${label} contains a non-finite value.`);
      }
      return sum + value * value;
    }, 0),
  );

  if (Math.abs(norm - 1.0) > 0.01) {
    throw new Error(`LSH: embedding is not L2-normalised (norm=${norm})`);
  }
}

function parseBucketKey(bucketKey: string, expectedBand: number): number {
  const match = BUCKET_KEY_PATTERN.exec(bucketKey);
  if (!match) {
    throw new Error(`[LSHIndex] Invalid bucket key format: ${bucketKey}`);
  }

  const band = Number(match[1]);
  const bucket = Number(match[2]);
  if (
    !Number.isInteger(band) ||
    band !== expectedBand ||
    band < 0 ||
    band >= LSH_BANDS
  ) {
    throw new Error(
      `[LSHIndex] Bucket key band mismatch: expected ${expectedBand}, got ${bucketKey}`,
    );
  }
  if (!Number.isInteger(bucket) || bucket < 0 || bucket > MAX_BUCKET_VALUE) {
    throw new Error(`[LSHIndex] Bucket key value is out of range: ${bucketKey}`);
  }

  return band;
}

function readColumnName(row: Record<string, unknown>): string {
  return String(row.name ?? row[1] ?? '');
}

function resolveLshSchema(db: DB): LshSchema {
  if (cachedSchema) {
    return cachedSchema;
  }

  const rows = getRows(executeSql(db, 'PRAGMA table_info(lsh_index);'));
  const columns = new Set(rows.map(readColumnName).filter(Boolean));
  const bandColumn: LshBandColumn = columns.has('hash_band')
    ? 'hash_band'
    : columns.has('band_index')
      ? 'band_index'
      : (() => {
          throw new Error(
            '[LSHIndex] lsh_index table is missing hash_band/band_index.',
          );
        })();

  cachedSchema = {
    bandColumn,
    hasSignature: columns.has('signature'),
    hasUpdatedAt: columns.has('updated_at'),
  };
  return cachedSchema;
}

async function computeBucketKeys(embedding: Float32Array): Promise<string[]> {
  const bucketKeys = await LSHModule.computeBucketKeys(float32ToBase64(embedding));
  if (bucketKeys.length !== LSH_BANDS) {
    throw new Error(
      `[LSHIndex] Expected ${LSH_BANDS} bucket keys, got ${bucketKeys.length}.`,
    );
  }
  bucketKeys.forEach((bucketKey, index) => parseBucketKey(bucketKey, index));
  return bucketKeys;
}

function insertBucketKey(params: {
  db: DB;
  schema: LshSchema;
  personnelId: string;
  bucketKey: string;
  band: number;
  signature: string;
  updatedAt: string;
}): void {
  const columns = ['personnel_id', 'bucket_key', params.schema.bandColumn];
  const values: unknown[] = [
    params.personnelId,
    params.bucketKey,
    params.band,
  ];

  if (params.schema.hasSignature) {
    columns.push('signature');
    values.push(params.signature);
  }
  if (params.schema.hasUpdatedAt) {
    columns.push('updated_at');
    values.push(params.updatedAt);
  }

  const placeholders = columns.map(() => '?').join(', ');
  executeSql(
    params.db,
    `INSERT INTO lsh_index (${columns.join(', ')}) VALUES (${placeholders});`,
    values,
  );
}

function readPersonnelId(row: Record<string, unknown>): string | null {
  const indexedRow = row as Record<string | number, unknown>;
  const value = row.personnel_id ?? row.id ?? indexedRow[0];
  return typeof value === 'string' && value.trim() ? value : null;
}

export const LSHIndex = {
  async indexEmbedding(params: {
    personnelId: string;
    embedding: Float32Array;
    db?: DB;
  }): Promise<void> {
    assertPersonnelId(params.personnelId);
    assertL2Normalised(params.embedding, 'embedding');

    const db = params.db ?? getDatabase();
    const schema = resolveLshSchema(db);
    const bucketKeys = await computeBucketKeys(params.embedding);
    const signature = bucketKeys.join('|');
    const updatedAt = new Date().toISOString();

    bucketKeys.forEach((bucketKey, index) => {
      insertBucketKey({
        db,
        schema,
        personnelId: params.personnelId,
        bucketKey,
        band: parseBucketKey(bucketKey, index),
        signature,
        updatedAt,
      });
    });
  },

  async query(params: {
    liveEmbedding: Float32Array;
  }): Promise<LSHCandidate[]> {
    assertL2Normalised(params.liveEmbedding, 'live embedding');

    const db = getDatabase();
    const schema = resolveLshSchema(db);
    const bucketKeys = await computeBucketKeys(params.liveEmbedding);
    const candidateIds = new Set<string>();
    let usedLinearScanFallback = false;

    bucketKeys.forEach((bucketKey, index) => {
      const rows = getRows(
        executeSql(
          db,
          `
            SELECT DISTINCT personnel_id
            FROM lsh_index
            WHERE bucket_key = ?
              AND ${schema.bandColumn} = ?;
          `,
          [bucketKey, parseBucketKey(bucketKey, index)],
        ),
      );

      for (const row of rows) {
        const personnelId = readPersonnelId(row);
        if (personnelId) {
          candidateIds.add(personnelId);
        }
      }
    });

    if (candidateIds.size === 0) {
      usedLinearScanFallback = true;
      console.warn(
        '[LSH FALLBACK] No LSH candidates found; running full personnel scan.',
      );
      const rows = getRows(
        executeSql(
          db,
          `
            SELECT personnel_id AS id
            FROM personnel
            WHERE enrollment_status = 'active';
          `,
        ),
      );
      for (const row of rows) {
        const personnelId = readPersonnelId(row);
        if (personnelId) {
          candidateIds.add(personnelId);
        }
      }
    }

    if (usedLinearScanFallback) {
      const candidates: LSHCandidate[] = [];
      for (const personnelId of candidateIds) {
        candidates.push({
          personnelId,
          embedding: await VerificationService.decryptEmbedding(personnelId),
        });
      }
      return candidates;
    }

    return Promise.all(
      Array.from(candidateIds, async (personnelId) => ({
        personnelId,
        embedding: await VerificationService.decryptEmbedding(personnelId),
      })),
    );
  },

  resetForTests(): void {
    cachedSchema = null;
  },
};
