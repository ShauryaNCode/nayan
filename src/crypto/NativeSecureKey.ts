import {NativeModules} from 'react-native';

export type NativeSecureKeyModule = {
  generateSecureRandomBase64?: (byteLength: number) => Promise<string>;
  generatePersonKey: (personnelId: string) => Promise<void>;
  wrapDEK: (personnelId: string, dekHex: string) => Promise<string>;
  unwrapDEK: (
    personnelId: string,
    wrappedDEKBase64: string,
  ) => Promise<string>;
  destroyPersonKey?: (personnelId: string) => Promise<void>;
  deletePersonKey?: (personnelId: string) => Promise<void>;
};

function getNativeModule(): NativeSecureKeyModule {
  const module =
    NativeModules.NativeSecureKey ??
    NativeModules.SecureEnclaveManager ??
    NativeModules.NativeBridge;

  if (
    !module ||
    typeof module.generatePersonKey !== 'function' ||
    typeof module.wrapDEK !== 'function' ||
    typeof module.unwrapDEK !== 'function'
  ) {
    throw new Error(
      '[NativeSecureKey] Native per-person key methods are unavailable. Rebuild the app after adding T3.2 native modules.',
    );
  }

  return module as NativeSecureKeyModule;
}

export const NativeSecureKey = {
  async generatePersonKey(personnelId: string): Promise<void> {
    return getNativeModule().generatePersonKey(personnelId);
  },

  async wrapDEK(personnelId: string, dekHex: string): Promise<string> {
    return getNativeModule().wrapDEK(personnelId, dekHex);
  },

  async unwrapDEK(
    personnelId: string,
    wrappedDEKBase64: string,
  ): Promise<string> {
    return getNativeModule().unwrapDEK(personnelId, wrappedDEKBase64);
  },

  async destroyPersonKey(personnelId: string): Promise<void> {
    const module = getNativeModule();
    if (typeof module.destroyPersonKey !== 'function') {
      throw new Error(
        '[NativeSecureKey] destroyPersonKey is unavailable. Rebuild the app after adding T3.6 native modules.',
      );
    }
    await module.destroyPersonKey(personnelId);
  },

  async deletePersonKey(personnelId: string): Promise<void> {
    const module = getNativeModule();
    if (typeof module.deletePersonKey === 'function') {
      await module.deletePersonKey(personnelId);
    }
  },

  getNativeModuleForTests(): NativeSecureKeyModule {
    return getNativeModule();
  },
};
