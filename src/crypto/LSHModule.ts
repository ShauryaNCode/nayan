import {
  NativeModules,
  TurboModuleRegistry,
  type TurboModule,
} from 'react-native';

type LSHModuleSpec = TurboModule & {
  loadHyperplanes: (hyperplanes: number[][][]) => Promise<void>;
  computeBucketKeys: (embeddingBase64: string) => Promise<string[]>;
};

function getNativeModule(): LSHModuleSpec {
  const turboModule = TurboModuleRegistry?.get<LSHModuleSpec>('LSHModule');
  const module = turboModule ?? NativeModules.LSHModule;

  if (
    !module ||
    typeof module.loadHyperplanes !== 'function' ||
    typeof module.computeBucketKeys !== 'function'
  ) {
    throw new Error(
      '[LSHModule] Native LSHModule is unavailable. Rebuild the app after adding the native LSH projection module.',
    );
  }

  return module as LSHModuleSpec;
}

export const LSHModule = {
  async loadHyperplanes(hyperplanes: number[][][]): Promise<void> {
    await getNativeModule().loadHyperplanes(hyperplanes);
  },

  async computeBucketKeys(embeddingBase64: string): Promise<string[]> {
    const keys = await getNativeModule().computeBucketKeys(embeddingBase64);
    if (!Array.isArray(keys)) {
      throw new Error('[LSHModule] Native projection returned a non-array result.');
    }
    return keys;
  },

  getNativeModuleForTests(): LSHModuleSpec {
    return getNativeModule();
  },
};
