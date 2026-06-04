/**
 * tests/integration/sync-flow.test.ts
 *
 * Integration Test – Offline Sync / AWS Flow
 *
 * Tests the coordination between OfflineQueueReader (in-memory) and
 * S3Uploader.uploadStub. Validates that items progress from PENDING →
 * PROCESSING → DONE and that uploadStub returns a success result
 * with expected shape.
 */

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
    destroy: jest.fn(),
  })),
}));

import {
  readNext,
  _inMemoryQueue,
  type QueueItem,
} from '../../src/sync/queue/OfflineQueueReader';
import {uploadStub} from '../../src/sync/aws/S3Uploader';

function seedQueue(items: Partial<QueueItem>[] = []): void {
  _inMemoryQueue.length = 0;
  items.forEach((item, idx) => {
    _inMemoryQueue.push({
      id: `sync-item-${idx + 1}`,
      payload: {event: 'face_auth_attempt', userId: `user_${idx}`, score: 0.95},
      enqueuedAt: new Date().toISOString(),
      status: 'PENDING',
      attempts: 0,
      ...item,
    });
  });
}

describe('Sync Flow – AWS Integration', () => {
  beforeEach(() => {
    seedQueue([
      {id: 'sync-001', payload: {event: 'enrollment', userId: 'u001', score: 0.99}},
      {id: 'sync-002', payload: {event: 'verification', userId: 'u002', score: 0.97}},
      {id: 'sync-003', payload: {event: 'verification', userId: 'u003', score: 0.82}},
    ]);
  });

  afterEach(() => {
    _inMemoryQueue.length = 0;
  });

  it('INT-S-01: uploadStub returns success result', () => {
    const result = uploadStub({event: 'test', userId: 'u001'});

    expect(result.success).toBe(true);
    expect(result.eTag).toMatch(/stub-etag/);
    expect(result.key).toMatch(/^stub\//);
    expect(result.uploadedAt).toBeTruthy();
  });

  it('INT-S-02: uploadStub key is unique per call', () => {
    const r1 = uploadStub({id: 1});
    const r2 = uploadStub({id: 2});

    expect(r1.key).not.toBe(r2.key);
  });

  it('INT-S-03: queue item transitions PENDING → PROCESSING on readNext', () => {
    const item = readNext()!;

    expect(item.status).toBe('PROCESSING');
    expect(item.attempts).toBe(1);
  });

  it('INT-S-04: upload after readNext succeeds and item can be marked DONE', () => {
    const item = readNext()!;
    const uploadResult = uploadStub(item.payload);

    expect(uploadResult.success).toBe(true);

    // Simulate marking item done
    item.status = 'DONE';

    const queueItem = _inMemoryQueue.find(i => i.id === item.id);
    expect(queueItem!.status).toBe('DONE');
  });

  it('INT-S-05: full batch sync drains all 3 items', () => {
    const uploaded: string[] = [];

    let item = readNext();
    while (item !== null) {
      const result = uploadStub(item.payload);
      if (result.success) {
        item.status = 'DONE';
        uploaded.push(item.id);
      }
      item = readNext();
    }

    expect(uploaded).toHaveLength(3);
    expect(uploaded).toContain('sync-001');
    expect(uploaded).toContain('sync-002');
    expect(uploaded).toContain('sync-003');
  });

  it('INT-S-06: failed item is not re-queued by readNext (must be explicit retry)', () => {
    const item = readNext()!;
    item.status = 'FAILED';

    // readNext skips FAILED status (only picks PENDING)
    const next = readNext();
    expect(next?.id).not.toBe(item.id);
  });

  it('INT-S-07: S3Client singleton is created without credentials (Phase 1 stub)', () => {
    const {getS3Client} = require('../../src/sync/aws/S3Uploader');
    const client = getS3Client();

    expect(client).toBeDefined();
  });
});
