import {NativeModules} from 'react-native';

import {NativeUptimeClock} from '../native/NativeUptimeClock';

const {DeviceIdentityModule} = NativeModules;

type DeviceIdentityNativeModule = {
  getOrCreateDeviceKey: () => Promise<string>;
  signDeletionReceipt: (receiptJson: string) => Promise<string>;
};

export interface DeletionReceipt {
  personnel_id: string;
  device_id: string;
  purge_ts: number;
  uptime_ms: number;
  command_nonce: string;
  signature?: string;
}

function getNativeModule(): DeviceIdentityNativeModule {
  if (
    !DeviceIdentityModule ||
    typeof DeviceIdentityModule.getOrCreateDeviceKey !== 'function' ||
    typeof DeviceIdentityModule.signDeletionReceipt !== 'function'
  ) {
    throw new Error(
      '[DeviceIdentityModule] Native module is unavailable. Rebuild the app after adding T3.7 native modules.',
    );
  }

  return DeviceIdentityModule as DeviceIdentityNativeModule;
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (!value.trim()) {
    throw new Error(`[deviceKey] ${fieldName} must not be empty.`);
  }
}

export async function getDevicePublicKey(): Promise<string> {
  const publicKey = await getNativeModule().getOrCreateDeviceKey();
  assertNonEmpty(publicKey, 'device public key');
  return publicKey;
}

export async function buildAndSignReceipt(
  personnelId: string,
  commandNonce: string,
): Promise<DeletionReceipt> {
  assertNonEmpty(personnelId, 'personnelId');
  assertNonEmpty(commandNonce, 'commandNonce');

  const deviceId = await getDevicePublicKey();
  const payload: DeletionReceipt = {
    personnel_id: personnelId,
    device_id: deviceId,
    purge_ts: Date.now(),
    uptime_ms: await NativeUptimeClock.getUptimeMs(),
    command_nonce: commandNonce,
  };
  const signature = await getNativeModule().signDeletionReceipt(
    JSON.stringify(payload),
  );

  assertNonEmpty(signature, 'signature');
  return {...payload, signature};
}
