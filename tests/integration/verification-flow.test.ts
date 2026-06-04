/**
 * tests/integration/verification-flow.test.ts
 *
 * Integration Test – Verification Flow
 *
 * Tests OfflineQueueReader (in-memory Phase 1 implementation) and
 * verifies that reading, marking, and draining the queue behaves
 * atomically and correctly.
 */

import {
  readNext,
  markProcessing,
  _inMemoryQueue,
  type QueueItem,
} from '../../src/sync/queue/OfflineQueueReader';

// Reset in-memory queue state before each test
function seedQueue(items: Partial<QueueItem>[] = []): void {
  _inMemoryQueue.length = 0;
  items.forEach((item, idx) => {
    _inMemoryQueue.push({
      id: `test-item-${idx + 1}`,
      payload: {event: 'face_auth_attempt', userId: `user_${idx}`, score: 0.97},
      enqueuedAt: new Date().toISOString(),
      status: 'PENDING',
      attempts: 0,
      ...item,
    });
  });
}

describe('Verification Flow – Queue Integration', () => {
  beforeEach(() => {
    seedQueue([{id: 'v-001'}, {id: 'v-002'}, {id: 'v-003'}]);
  });

  afterEach(() => {
    _inMemoryQueue.length = 0;
  });

  it('INT-V-01: readNext returns first PENDING item', () => {
    const item = readNext();

    expect(item).not.toBeNull();
    expect(item!.id).toBe('v-001');
    expect(item!.status).toBe('PROCESSING');
    expect(item!.attempts).toBe(1);
  });

  it('INT-V-02: readNext skips PROCESSING items and returns next PENDING', () => {
    readNext(); // claim v-001
    const second = readNext();

    expect(second!.id).toBe('v-002');
    expect(second!.status).toBe('PROCESSING');
  });

  it('INT-V-03: readNext returns null when queue is empty', () => {
    seedQueue([]);
    expect(readNext()).toBeNull();
  });

  it('INT-V-04: readNext returns null when all items are PROCESSING', () => {
    readNext(); // v-001 → PROCESSING
    readNext(); // v-002 → PROCESSING
    readNext(); // v-003 → PROCESSING

    expect(readNext()).toBeNull();
  });

  it('INT-V-05: markProcessing sets status on existing item', () => {
    const result = markProcessing('v-002');

    expect(result).toBe(true);
    expect(_inMemoryQueue.find(i => i.id === 'v-002')?.status).toBe('PROCESSING');
  });

  it('INT-V-06: markProcessing returns false for unknown id', () => {
    const result = markProcessing('nonexistent-id');
    expect(result).toBe(false);
  });

  it('INT-V-07: queue can be fully drained in order', () => {
    const drained: string[] = [];
    let item = readNext();
    while (item !== null) {
      drained.push(item.id);
      item = readNext();
    }

    expect(drained).toEqual(['v-001', 'v-002', 'v-003']);
  });

  it('INT-V-08: attempts counter increments on each readNext for same item', () => {
    // Manually re-PENDING an item to simulate retry
    const item = readNext()!;
    item.status = 'PENDING'; // simulate retry scenario

    const retried = readNext();
    expect(retried!.id).toBe(item.id);
    expect(retried!.attempts).toBe(2);
  });
});
