import {
  NativeModules,
  TurboModuleRegistry,
  type TurboModule,
} from 'react-native';

type NativeUptimeClockSpec = TurboModule & {
  getUptimeMs: () => Promise<number>;
};

function getNativeModule(): NativeUptimeClockSpec {
  const turboModule =
    TurboModuleRegistry?.get<NativeUptimeClockSpec>('NativeUptimeClock');
  const module = turboModule ?? NativeModules.NativeUptimeClock;

  if (!module || typeof module.getUptimeMs !== 'function') {
    throw new Error(
      '[NativeUptimeClock] NativeUptimeClock is unavailable. Rebuild the app after adding the native uptime module.',
    );
  }

  return module as NativeUptimeClockSpec;
}

export const NativeUptimeClock = {
  async getUptimeMs(): Promise<number> {
    const value = await getNativeModule().getUptimeMs();
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`[NativeUptimeClock] Invalid uptime value: ${String(value)}.`);
    }
    return value;
  },
};
