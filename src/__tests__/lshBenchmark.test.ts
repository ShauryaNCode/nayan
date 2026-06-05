import {performance} from 'perf_hooks';

import {LSH_HYPERPLANES} from '../crypto/LSHHyperplanes';
import {base64ToFloat32} from '../utils/BufferUtils';

const mockPersonnelEmbeddings = new Map<string, Float32Array>();
const mockBucketIndex = new Map<string, Set<string>>();
let mockLoadedHyperplanes: number[][][] | null = null;

function result(rows: Array<Record<string, unknown>> = []) {
  return {rows, rowsAffected: rows.length};
}

function bucketIndexKey(bucketKey: string, bandIndex: number): string {
  return `${bandIndex}|${bucketKey}`;
}

const mockDb = {
  executeSync: jest.fn((sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (normalized === 'PRAGMA table_info(lsh_index);') {
      return result([
        {name: 'bucket_key'},
        {name: 'personnel_id'},
        {name: 'band_index'},
        {name: 'signature'},
        {name: 'updated_at'},
      ]);
    }

    if (normalized.startsWith('INSERT INTO lsh_index')) {
      const personnelId = params[0] as string;
      const bucketKey = params[1] as string;
      const bandIndex = params[2] as number;
      const key = bucketIndexKey(bucketKey, bandIndex);
      let ids = mockBucketIndex.get(key);
      if (!ids) {
        ids = new Set<string>();
        mockBucketIndex.set(key, ids);
      }
      ids.add(personnelId);
      return result();
    }

    if (normalized.startsWith('SELECT DISTINCT personnel_id FROM lsh_index')) {
      const bucketKey = params[0] as string;
      const bandIndex = params[1] as number;
      const ids = mockBucketIndex.get(bucketIndexKey(bucketKey, bandIndex));
      return result(
        Array.from(ids ?? []).map((personnel_id) => ({personnel_id})),
      );
    }

    if (normalized.startsWith('SELECT personnel_id AS id FROM personnel')) {
      return result(
        Array.from(mockPersonnelEmbeddings.keys()).map((id) => ({id})),
      );
    }

    throw new Error(`Unexpected SQL in LSH benchmark: ${normalized}`);
  }),
};

function computeBucketKeys(embeddingBase64: string): string[] {
  if (!mockLoadedHyperplanes) {
    throw new Error('LSH hyperplanes not loaded');
  }

  const embedding = base64ToFloat32(embeddingBase64);
  return mockLoadedHyperplanes.map((band, bandIndex) => {
    let bits = 0;
    band.forEach((plane, planeIndex) => {
      let dot = 0;
      for (let i = 0; i < embedding.length; i += 1) {
        dot += embedding[i] * plane[i];
      }
      if (dot > 0) {
        bits |= 1 << planeIndex;
      }
    });
    return `${bandIndex}_${bits}`;
  });
}

const mockNativeModules = {
  LSHModule: {
    loadHyperplanes: jest.fn(async (hyperplanes: number[][][]) => {
      mockLoadedHyperplanes = hyperplanes;
    }),
    computeBucketKeys: jest.fn(async (embeddingBase64: string) =>
      computeBucketKeys(embeddingBase64),
    ),
  },
};

jest.mock('react-native', () => ({
  NativeModules: mockNativeModules,
  TurboModuleRegistry: {
    get: jest.fn(
      (name: string) =>
        mockNativeModules[name as keyof typeof mockNativeModules] ?? null,
    ),
  },
  Platform: {
    OS: 'android',
  },
}));

jest.mock('../storage/database/DatabaseManager', () => ({
  getDatabase: () => mockDb,
}));

jest.mock('../storage/VerificationService', () => ({
  VerificationService: {
    decryptEmbedding: jest.fn(async (personnelId: string) => {
      const embedding = mockPersonnelEmbeddings.get(personnelId);
      if (!embedding) {
        throw new Error(`Missing embedding for ${personnelId}`);
      }
      return new Float32Array(embedding);
    }),
  },
}));

import {LSHModule} from '../crypto/LSHModule';
import {LSHIndex} from '../storage/LSHIndex';

type BenchmarkRow = {
  profiles: number;
  medianMs: number;
  p95Ms: number;
};

jest.setTimeout(30000);

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function normalise(values: Float32Array): Float32Array {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  const output = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    output[i] = values[i] / norm;
  }
  return output;
}

function randomEmbedding(seed: number): Float32Array {
  const random = createSeededRandom(seed);
  const values = new Float32Array(128);
  for (let i = 0; i < values.length; i += 1) {
    values[i] = random() * 2 - 1;
  }
  return normalise(values);
}

function percentile(sortedValues: number[], percentileRank: number): number {
  const index = Math.min(
    sortedValues.length - 1,
    Math.ceil((percentileRank / 100) * sortedValues.length) - 1,
  );
  return sortedValues[index];
}

async function seedIndex(profileCount: number): Promise<Float32Array[]> {
  mockPersonnelEmbeddings.clear();
  mockBucketIndex.clear();
  mockLoadedHyperplanes = null;
  LSHIndex.resetForTests();
  await LSHModule.loadHyperplanes(LSH_HYPERPLANES);

  const embeddings: Float32Array[] = [];
  for (let i = 0; i < profileCount; i += 1) {
    const personnelId = `person-${profileCount}-${i}`;
    const embedding = randomEmbedding(profileCount * 10_000 + i);
    embeddings.push(embedding);
    mockPersonnelEmbeddings.set(personnelId, new Float32Array(embedding));
    await LSHIndex.indexEmbedding({
      personnelId,
      embedding,
      db: mockDb as never,
    });
  }

  return embeddings;
}

async function runBenchmark(profileCount: number): Promise<BenchmarkRow> {
  const embeddings = await seedIndex(profileCount);
  const latencies: number[] = [];

  for (let i = 0; i < 50; i += 1) {
    const queryEmbedding = embeddings[(i * 997) % profileCount];
    const start = performance.now();
    const candidates = await LSHIndex.query({liveEmbedding: queryEmbedding});
    latencies.push(performance.now() - start);
    expect(candidates.length).toBeGreaterThan(0);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    profiles: profileCount,
    medianMs: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
  };
}

describe('LSH lookup latency benchmark', () => {
  it('keeps lookup latency inside target budgets', async () => {
    const rows = [
      await runBenchmark(100),
      await runBenchmark(1000),
      await runBenchmark(5000),
    ];

    console.table(
      rows.map((row) => ({
        profiles: row.profiles,
        median_ms: row.medianMs.toFixed(3),
        p95_ms: row.p95Ms.toFixed(3),
      })),
    );

    expect(rows[0].medianMs).toBeLessThan(5);
    expect(rows[1].medianMs).toBeLessThan(15);
    expect(rows[2].medianMs).toBeLessThan(40);
  });
});
