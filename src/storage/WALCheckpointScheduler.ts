import {AppState, type AppStateStatus} from 'react-native';
import type {QueryResult} from '@op-engineering/op-sqlite';

import {getDatabase} from './database/DatabaseManager';
import {executeSql, getFirstRow} from './database/SQLiteCompat';

// M4 integration: call WALCheckpointScheduler.runNow() after each successful S3 upload ACK.

export const RETRY_DELAY_MS = 30_000;
export const IDLE_TIMEOUT_MS = 10_000;

export interface WALCheckpointStats {
  busy: number;
  totalFrames: number;
  checkpointedFrames: number;
}

let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null =
  null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

function numberOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readNamedNumber(
  row: Record<string | number, unknown>,
  names: string[],
): number | undefined {
  for (const name of names) {
    if (row[name] != null) {
      return numberOrZero(row[name]);
    }
  }
  return undefined;
}

function parseIndexedValues(values: unknown[]): WALCheckpointStats {
  if (values.length >= 3) {
    return {
      busy: numberOrZero(values[0]),
      totalFrames: numberOrZero(values[1]),
      checkpointedFrames: numberOrZero(values[2]),
    };
  }

  if (values.length >= 2) {
    return {
      busy: 0,
      totalFrames: numberOrZero(values[0]),
      checkpointedFrames: numberOrZero(values[1]),
    };
  }

  return {busy: 0, totalFrames: 0, checkpointedFrames: 0};
}

export function parseWALCheckpointResult(
  result: QueryResult,
): WALCheckpointStats {
  const row = getFirstRow(result);
  if (!row) {
    return {busy: 0, totalFrames: 0, checkpointedFrames: 0};
  }

  if (Array.isArray(row)) {
    return parseIndexedValues(row);
  }

  const indexedRow = row as Record<string | number, unknown>;
  const compoundValue = indexedRow.wal_checkpoint;
  if (Array.isArray(compoundValue)) {
    return parseIndexedValues(compoundValue);
  }

  const namedTotal = readNamedNumber(indexedRow, [
    'log',
    'wal_log',
    'total',
    'total_frames',
    'wal_frames',
  ]);
  const namedCheckpointed = readNamedNumber(indexedRow, [
    'checkpointed',
    'wal_checkpointed',
    'checkpointed_frames',
  ]);

  if (namedTotal != null && namedCheckpointed != null) {
    return {
      busy: readNamedNumber(indexedRow, ['busy', 'wal_busy']) ?? 0,
      totalFrames: namedTotal,
      checkpointedFrames: namedCheckpointed,
    };
  }

  if (indexedRow[2] != null) {
    return parseIndexedValues([indexedRow[0], indexedRow[1], indexedRow[2]]);
  }

  if (indexedRow[1] != null) {
    return parseIndexedValues([indexedRow[0], indexedRow[1]]);
  }

  return {busy: 0, totalFrames: 0, checkpointedFrames: 0};
}

function clearRetryTimer(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry(): void {
  if (retryTimer !== null) {
    return;
  }

  retryTimer = setTimeout(() => {
    retryTimer = null;
    runPassiveCheckpoint();
  }, RETRY_DELAY_MS);
}

function runPassiveCheckpoint(): void {
  try {
    const db = getDatabase();
    // PASSIVE never waits for active readers or writers.
    const result = executeSql(db, 'PRAGMA wal_checkpoint(PASSIVE);');
    const stats = parseWALCheckpointResult(result);

    if (stats.checkpointedFrames < stats.totalFrames) {
      scheduleRetry();
      return;
    }

    clearRetryTimer();
  } catch (_) {
    // DB may not be open yet. The next safe trigger will retry.
  }
}

function handleAppStateChange(nextState: AppStateStatus): void {
  if (nextState === 'background' || nextState === 'active') {
    runPassiveCheckpoint();
  }
}

export const WALCheckpointScheduler = {
  start(): void {
    if (isRunning) {
      return;
    }

    isRunning = true;
    appStateSubscription = AppState.addEventListener(
      'change',
      handleAppStateChange,
    );

    // TODO: wire M2 liveness FSM idle event when M2 confirms their event interface.
    // Placeholder: runPassiveCheckpoint() should be called after 10s of FSM IDLE.
    // Expected interface: LivenessFSMEvents.on('stateChange', (state) => { ... }).
  },

  stop(): void {
    isRunning = false;
    appStateSubscription?.remove();
    appStateSubscription = null;

    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }

    clearRetryTimer();
  },

  runNow(): void {
    runPassiveCheckpoint();
  },
};
