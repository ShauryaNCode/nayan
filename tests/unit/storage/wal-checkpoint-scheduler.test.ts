type AppStateListener = (state: string) => void;

const mockAppStateListeners = new Set<AppStateListener>();
const mockAddEventListener = jest.fn(
  (_eventName: string, listener: AppStateListener) => {
    mockAppStateListeners.add(listener);
    return {
      remove: jest.fn(() => {
        mockAppStateListeners.delete(listener);
      }),
    };
  },
);

const mockDb = {
  executeSync: jest.fn(),
};

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: (eventName: string, listener: AppStateListener) =>
      mockAddEventListener(eventName, listener),
  },
}));

jest.mock('../../../src/storage/database/DatabaseManager', () => ({
  getDatabase: jest.fn(() => mockDb),
}));

import {
  parseWALCheckpointResult,
  RETRY_DELAY_MS,
  WALCheckpointScheduler,
} from '../../../src/storage/WALCheckpointScheduler';

function result(rows: unknown) {
  return {
    rowsAffected: 0,
    rows,
  };
}

function emitAppState(state: string): void {
  for (const listener of Array.from(mockAppStateListeners)) {
    listener(state);
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  WALCheckpointScheduler.stop();
  mockAppStateListeners.clear();
  mockAddEventListener.mockClear();
  mockDb.executeSync.mockReset();
  mockDb.executeSync.mockReturnValue(
    result([{busy: 0, log: 1, checkpointed: 1}]),
  );
});

afterEach(() => {
  WALCheckpointScheduler.stop();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('T3.5 WAL checkpoint scheduler', () => {
  it('parses named SQLite wal_checkpoint columns', () => {
    expect(
      parseWALCheckpointResult(
        result([{busy: 0, log: 12, checkpointed: 8}]) as any,
      ),
    ).toEqual({
      busy: 0,
      totalFrames: 12,
      checkpointedFrames: 8,
    });
  });

  it('parses op-sqlite _array rows and indexed checkpoint rows', () => {
    const rows = {
      _array: [{0: 0, 1: 15, 2: 15}],
      length: 1,
      item: (index: number) => rows._array[index],
    };

    expect(parseWALCheckpointResult({rowsAffected: 0, rows} as any)).toEqual({
      busy: 0,
      totalFrames: 15,
      checkpointedFrames: 15,
    });
  });

  it('parses two-value wal_checkpoint arrays defensively', () => {
    expect(
      parseWALCheckpointResult(
        result([{wal_checkpoint: [20, 17]}]) as any,
      ),
    ).toEqual({
      busy: 0,
      totalFrames: 20,
      checkpointedFrames: 17,
    });
  });

  it('runNow issues a PASSIVE checkpoint and returns without a promise', () => {
    const returnValue = WALCheckpointScheduler.runNow();

    expect(returnValue).toBeUndefined();
    expect(mockDb.executeSync).toHaveBeenCalledWith(
      'PRAGMA wal_checkpoint(PASSIVE);',
      undefined,
    );
  });

  it('runs a checkpoint on background and active AppState transitions', () => {
    WALCheckpointScheduler.start();

    emitAppState('background');
    emitAppState('active');

    expect(mockDb.executeSync).toHaveBeenCalledTimes(2);
    expect(mockDb.executeSync).toHaveBeenNthCalledWith(
      1,
      'PRAGMA wal_checkpoint(PASSIVE);',
      undefined,
    );
    expect(mockDb.executeSync).toHaveBeenNthCalledWith(
      2,
      'PRAGMA wal_checkpoint(PASSIVE);',
      undefined,
    );
  });

  it('start is idempotent and registers one AppState listener', () => {
    WALCheckpointScheduler.start();
    WALCheckpointScheduler.start();
    WALCheckpointScheduler.start();

    expect(mockAddEventListener).toHaveBeenCalledTimes(1);
    expect(mockAddEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function),
    );
    expect(mockAppStateListeners.size).toBe(1);
  });

  it('schedules one retry when PASSIVE cannot checkpoint all frames', () => {
    mockDb.executeSync.mockReturnValue(
      result([{busy: 0, log: 10, checkpointed: 4}]),
    );

    WALCheckpointScheduler.runNow();
    WALCheckpointScheduler.runNow();

    expect(jest.getTimerCount()).toBe(1);
    expect(mockDb.executeSync).toHaveBeenCalledTimes(2);

    mockDb.executeSync.mockReturnValue(
      result([{busy: 0, log: 10, checkpointed: 10}]),
    );

    jest.advanceTimersByTime(RETRY_DELAY_MS - 1);
    expect(mockDb.executeSync).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(1);
    expect(mockDb.executeSync).toHaveBeenCalledTimes(3);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stop removes AppState listeners and clears pending retry timers', () => {
    mockDb.executeSync.mockReturnValue(
      result([{busy: 0, log: 10, checkpointed: 4}]),
    );
    WALCheckpointScheduler.start();
    WALCheckpointScheduler.runNow();

    expect(jest.getTimerCount()).toBe(1);

    WALCheckpointScheduler.stop();
    emitAppState('background');
    jest.advanceTimersByTime(RETRY_DELAY_MS);

    expect(mockDb.executeSync).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    expect(mockAppStateListeners.size).toBe(0);
  });
});
