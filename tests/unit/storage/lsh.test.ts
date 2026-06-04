import {performance} from 'perf_hooks';

import {LSH_HYPERPLANES} from '../../../src/crypto/LSHHyperplanes';
import {base64ToFloat32, float32ToBase64} from '../../../src/utils/BufferUtils';

const mockPersonnelEmbeddings = new Map<string, Float32Array>();
const mockLshRows: Array<{
  personnel_id: string;
  bucket_key: string;
  band_index: number;
  signature: string;
  updated_at: string;
}> = [];
const mockBucketIndex = new Map<string, Set<string>>();
let mockLoadedHyperplanes: number[][][] | null = null;

function result(rows: Array<Record<string, unknown>> = []) {
  return {rows, rowsAffected: rows.length};
}

function bucketIndexKey(bucketKey: string, bandIndex: number): string {
  return `${bandIndex}|${bucketKey}`;
}

function addToBucketIndex(
  personnelId: string,
  bucketKey: string,
  bandIndex: number,
): void {
  const key = bucketIndexKey(bucketKey, bandIndex);
  let values = mockBucketIndex.get(key);
  if (!values) {
    values = new Set<string>();
    mockBucketIndex.set(key, values);
  }
  values.add(personnelId);
}

const mockDb = {
  executeSync: jest.fn((sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (
      normalized === 'BEGIN IMMEDIATE;' ||
      normalized === 'COMMIT;' ||
      normalized === 'ROLLBACK;' ||
      normalized === 'PRAGMA defer_foreign_keys=ON;'
    ) {
      return result();
    }

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
      const row = {
        personnel_id: params[0] as string,
        bucket_key: params[1] as string,
        band_index: params[2] as number,
        signature: params[3] as string,
        updated_at: params[4] as string,
      };
      mockLshRows.push(row);
      addToBucketIndex(row.personnel_id, row.bucket_key, row.band_index);
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

    if (normalized.startsWith('SELECT COUNT(*) AS count FROM lsh_index')) {
      return result([{count: mockLshRows.length}]);
    }

    throw new Error(`Unexpected SQL in LSH test: ${normalized}`);
  }),
};

function computeKeysWithLoadedHyperplanes(embeddingBase64: string): string[] {
  if (!mockLoadedHyperplanes) {
    throw new Error('LSHProjection: hyperplanes not loaded');
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
      computeKeysWithLoadedHyperplanes(embeddingBase64),
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

jest.mock('../../../src/storage/database/DatabaseManager', () => ({
  getDatabase: () => mockDb,
}));

jest.mock('../../../src/storage/VerificationService', () => ({
  VerificationService: {
    decryptEmbedding: jest.fn(async (personnelId: string) => {
      const embedding = mockPersonnelEmbeddings.get(personnelId);
      if (!embedding) {
        throw new Error(`missing embedding for ${personnelId}`);
      }
      return new Float32Array(embedding);
    }),
  },
}));

const {LSHModule} = require('../../../src/crypto/LSHModule');
const {LSHIndex} = require('../../../src/storage/LSHIndex');

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function normalise(values: Float32Array): Float32Array {
  const norm = Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0),
  );
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

function gaussian(random: () => number): number {
  const u1 = Math.max(random(), Number.EPSILON);
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function addGaussianNoise(
  embedding: Float32Array,
  scale: number,
  seed: number,
): Float32Array {
  const random = createSeededRandom(seed);
  const noisy = new Float32Array(embedding.length);
  for (let i = 0; i < embedding.length; i += 1) {
    noisy[i] = embedding[i] + gaussian(random) * scale;
  }
  return normalise(noisy);
}

async function enrollIndexed(
  personnelId: string,
  embedding: Float32Array,
): Promise<void> {
  mockPersonnelEmbeddings.set(personnelId, new Float32Array(embedding));
  await LSHIndex.indexEmbedding({
    personnelId,
    embedding,
    db: mockDb,
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockPersonnelEmbeddings.clear();
  mockLshRows.length = 0;
  mockBucketIndex.clear();
  mockLoadedHyperplanes = null;
  LSHIndex.resetForTests();
  await LSHModule.loadHyperplanes(LSH_HYPERPLANES);
});

describe('T3.4 LSH vector index', () => {
  it('computes deterministic bucket keys for the same embedding', async () => {
    const embeddingBase64 = float32ToBase64(randomEmbedding(101));

    const first = await LSHModule.computeBucketKeys(embeddingBase64);
    const second = await LSHModule.computeBucketKeys(embeddingBase64);

    expect(second).toEqual(first);
  });

  it('returns bucket keys in band_integer format', async () => {
    const keys = await LSHModule.computeBucketKeys(
      float32ToBase64(randomEmbedding(102)),
    );

    expect(keys).toHaveLength(4);
    for (const key of keys) {
      expect(key).toMatch(/^\d_\d+$/);
    }
  });

  it('recalls the same enrolled person on exact embedding queries 20/20 times', async () => {
    for (let i = 0; i < 20; i += 1) {
      mockPersonnelEmbeddings.clear();
      mockLshRows.length = 0;
      mockBucketIndex.clear();
      LSHIndex.resetForTests();

      const personnelId = `person-exact-${i}`;
      const embedding = randomEmbedding(200 + i);
      await enrollIndexed(personnelId, embedding);

      const candidates = await LSHIndex.query({liveEmbedding: embedding});
      expect(candidates.map((candidate) => candidate.personnelId)).toContain(
        personnelId,
      );
    }
  });

  it('recalls the same enrolled person for a similar noisy embedding', async () => {
    const personnelId = 'person-similar';
    const enrollmentEmbedding = randomEmbedding(301);
    const liveEmbedding = addGaussianNoise(enrollmentEmbedding, 0.01, 302);

    await enrollIndexed(personnelId, enrollmentEmbedding);

    const candidates = await LSHIndex.query({liveEmbedding});
    expect(candidates.map((candidate) => candidate.personnelId)).toContain(
      personnelId,
    );
  });

  it('keeps the candidate set size between 1 and 20 for 100 indexed people', async () => {
    const queryEmbedding = randomEmbedding(400);
    await enrollIndexed('person-query', queryEmbedding);
    for (let i = 1; i < 100; i += 1) {
      await enrollIndexed(`person-${i}`, randomEmbedding(400 + i));
    }

    const candidates = await LSHIndex.query({liveEmbedding: queryEmbedding});

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates.length).toBeLessThanOrEqual(20);
  });

  it('falls back to a linear scan on an empty DB without crashing', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const candidates = await LSHIndex.query({
      liveEmbedding: randomEmbedding(501),
    });

    expect(candidates).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[LSH FALLBACK]'),
    );
    warnSpy.mockRestore();
  });

  it('writes exactly four index rows per enrolled person', async () => {
    for (let i = 0; i < 5; i += 1) {
      await enrollIndexed(`person-integrity-${i}`, randomEmbedding(600 + i));
    }

    const countRows = mockDb.executeSync(
      'SELECT COUNT(*) AS count FROM lsh_index;',
    ).rows;

    expect(countRows[0].count).toBe(20);
  });

  it('queries 200 indexed people in under 5ms on average', async () => {
    const queryEmbedding = randomEmbedding(700);
    await enrollIndexed('person-benchmark-query', queryEmbedding);
    for (let i = 1; i < 200; i += 1) {
      await enrollIndexed(`person-benchmark-${i}`, randomEmbedding(700 + i));
    }

    const iterations = 50;
    const start = performance.now();
    for (let i = 0; i < iterations; i += 1) {
      await LSHIndex.query({liveEmbedding: queryEmbedding});
    }
    const averageMs = (performance.now() - start) / iterations;
    const extrapolatedMs = averageMs * 25;

    console.log(
      `[LSH BENCHMARK] avg=${averageMs.toFixed(4)}ms; 5000-profile linear test extrapolation=${extrapolatedMs.toFixed(4)}ms`,
    );

    expect(averageMs).toBeLessThan(5);
    expect(extrapolatedMs).toBeLessThan(5);
  });
});
