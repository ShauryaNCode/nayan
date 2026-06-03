import {NativeModules, Platform} from 'react-native';

import {
  VisionCameraProxy,
  type Frame,
  type FrameProcessorPlugin,
} from 'react-native-vision-camera';

import type {
  NativeBridgeModule,
  NativeFaceAuthModule,
  NativeFaceAuthResult,
  NativeLivenessChallenge,
  NativeLivenessChallengeCode,
  NativeLivenessState,
  NativeLivenessStateCode,
} from '../../types/native';

const NativeBridge = NativeModules.NativeBridge as NativeBridgeModule | undefined;
const GLOBAL_MODULE_NAME = '__offlineFaceAuth';
const FRAME_PROCESSOR_PLUGIN_NAME = 'nayanFaceAuth';

const LIVENESS_STATE_TO_CODE: Record<NativeLivenessState, NativeLivenessStateCode> = {
  IDLE: 0,
  DETECTED: 1,
  CHALLENGE_ACTIVE: 2,
  LIVENESS_PASS: 3,
  LIVENESS_FAIL: 4,
};

const LIVENESS_CHALLENGE_TO_CODE: Record<
  NativeLivenessChallenge,
  NativeLivenessChallengeCode
> = {
  NONE: 0,
  BLINK: 1,
  SMILE: 2,
  TURN_LEFT: 3,
  TURN_RIGHT: 4,
};

declare global {
  // eslint-disable-next-line no-var
  var __offlineFaceAuth: NativeFaceAuthModule | undefined;
}

export function getNativeFaceAuth(): NativeFaceAuthModule | undefined {
  return globalThis[GLOBAL_MODULE_NAME as keyof typeof globalThis] as
    | NativeFaceAuthModule
    | undefined;
}

export async function initializeFrameProcessorBridge(
  modelPath?: string | null,
): Promise<boolean> {
  if (NativeBridge == null) {
    return false;
  }

  await NativeBridge.initializeEngine(modelPath ?? null);
  const installed = await NativeBridge.ensureJsiInstalled();
  getNayanFrameProcessorPlugin();
  const initialCount = getLatestFrameResult()?.framesProcessed ?? 0;
  // eslint-disable-next-line no-console
  console.log('[DIAG] Initial frames_processed:', initialCount);
  setTimeout(() => {
    const count = getLatestFrameResult()?.framesProcessed ?? 0;
    // eslint-disable-next-line no-console
    console.log('[DIAG] frames_processed after 1s:', count);
    if (count === initialCount) {
      // eslint-disable-next-line no-console
      console.error(
        '[FATAL] FrameProcessorPlugin not receiving frames. Check worklet registration.',
      );
    }
  }, 1000);
  return installed;
}

export function isFrameProcessorBridgeReady(): boolean {
  const nativeFaceAuth = getNativeFaceAuth();
  return Boolean(
    nativeFaceAuth?.frameProcessorRegistryReady && nativeFaceAuth.isInitialized(),
  );
}

export function getLatestFrameResult(): NativeFaceAuthResult | null {
  return getNativeFaceAuth()?.getLatestResult() ?? null;
}

function loadFrameProcessorPlugin(): FrameProcessorPlugin | undefined {
  try {
    return VisionCameraProxy.initFrameProcessorPlugin(
      FRAME_PROCESSOR_PLUGIN_NAME,
      {},
    );
  } catch {
    return undefined;
  }
}

let nayanFrameProcessorPlugin: FrameProcessorPlugin | undefined;

function getNayanFrameProcessorPlugin(): FrameProcessorPlugin | undefined {
  if (nayanFrameProcessorPlugin == null) {
    nayanFrameProcessorPlugin = loadFrameProcessorPlugin();
  }
  return nayanFrameProcessorPlugin;
}

export function isNativeFrameProcessorPluginAvailable(): boolean {
  return getNayanFrameProcessorPlugin() != null;
}

export function getNativeFrameProcessorPlugin(): FrameProcessorPlugin | undefined {
  return getNayanFrameProcessorPlugin();
}

export function processNayanCameraFrame(frame: Frame): boolean {
  'worklet';
  return nayanFrameProcessorPlugin?.call(frame) === true;
}

export async function setNativeLivenessState(
  state: NativeLivenessState,
): Promise<void> {
  await NativeBridge?.setLivenessState(state);
  getNativeFaceAuth()?.setLivenessState(LIVENESS_STATE_TO_CODE[state]);
}

export async function setNativeLivenessChallenge(
  challenge: NativeLivenessChallenge,
): Promise<void> {
  await NativeBridge?.setLivenessChallenge(challenge);
  getNativeFaceAuth()?.setLivenessChallenge(LIVENESS_CHALLENGE_TO_CODE[challenge]);
}

export async function markNativeLivenessPassed(passed: boolean): Promise<void> {
  await NativeBridge?.setLivenessPassed(passed);
  getNativeFaceAuth()?.setLivenessState(passed ? 3 : 2);
}

export async function enqueueLumaFrame(
  buffer: ArrayBuffer,
  width: number,
  height: number,
  stride: number,
  timestampNs: number,
): Promise<boolean> {
  if (NativeBridge == null || Platform.OS !== 'android') {
    return false;
  }

  return NativeBridge.enqueueFrame(buffer, width, height, stride, timestampNs);
}

export const NativeLivenessCodes = {
  states: LIVENESS_STATE_TO_CODE,
  challenges: LIVENESS_CHALLENGE_TO_CODE,
} as const;
