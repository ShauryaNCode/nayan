import {MMKV} from 'react-native-mmkv';

export const EVENT_COUNTER_MMKV_ID = 'nayan.m3.event-counter.v1';
export const EVENT_COUNTER_KEY = 'm3_event_counter';

const storage = new MMKV({id: EVENT_COUNTER_MMKV_ID});

function readNextCounterValue(): number {
  const value = storage.getNumber(EVENT_COUNTER_KEY);
  if (value === undefined) {
    return 1;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`[EventCounter] Invalid persisted counter value: ${String(value)}.`);
  }
  return value;
}

export const EventCounter = {
  getNext(): number {
    // React Native executes this JS critical section on a single JS thread, and
    // MMKV reads/writes are synchronous, so no other JS call can interleave here.
    const nextValue = readNextCounterValue();
    storage.set(EVENT_COUNTER_KEY, nextValue + 1);
    return nextValue;
  },

  resetForTests(): void {
    storage.delete(EVENT_COUNTER_KEY);
  },
};
