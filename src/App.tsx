import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  AppState,
  NativeModules,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type {AppStateStatus} from 'react-native';
import {startConnectivityWatcher} from './sync/connectivity/ConnectivityWatcher';
import {
  closeDatabase,
  openProductionDatabase,
} from './storage/database/DatabaseManager';
import {ErasureService} from './storage/ErasureService';
import {WALCheckpointScheduler} from './storage/WALCheckpointScheduler';
import {getDevicePublicKey} from './services/deviceKey';

import {CameraView} from './components/camera/CameraView';
import {
  initializeFrameProcessorBridge,
  isNativeFrameProcessorPluginAvailable,
  setNativeLivenessChallenge,
} from './components/camera/FrameProcessorBridge';

import {
  runMMKVSmokeTest,
  runSQLCipherSmokeTest,
  type SmokeTestResult,
} from './storage/database/SmokeTest';

import type {
  NativeBridgeModule,
  NativeFaceAuthResult,
  NativeLivenessChallenge,
} from './types/native';

type OfflineFaceAuthGlobal = {
  getLatestResult: () => NativeFaceAuthResult;
  isInitialized: () => boolean;
  setLivenessState?: (state: number) => boolean;
  setLivenessChallenge?: (challenge: number) => boolean;
};

const MODEL_PATH = '/sdcard/Download/mobilefacenet.tflite';
const LIVENESS_STATE_NAMES = [
  'IDLE',
  'DETECTED',
  'CHALLENGE_ACTIVE',
  'LIVENESS_PASS',
  'LIVENESS_FAIL',
] as const;
const LIVENESS_CHALLENGE_NAMES = [
  'NONE',
  'BLINK',
  'SMILE',
  'TURN_LEFT',
  'TURN_RIGHT',
] as const;

const COLORS = {
  background: '#050B1A',
  primary: '#00BFFF',
  success: '#00FF88',
  error: '#FF4D4D',
  glass: 'rgba(255, 255, 255, 0.05)',
  glassBorder: 'rgba(255, 255, 255, 0.1)',
  textPrimary: '#FFFFFF',
  textSecondary: '#94a3b8',
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: COLORS.background},
  scrollContent: {paddingHorizontal: 20, paddingBottom: 40},
  headerSection: {
    marginTop: 20,
    marginBottom: 24,
    alignItems: 'center',
  },
  logoText: {
    fontSize: 12,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 4,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  header: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  subheader: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 20,
  },
  cameraSection: {
    marginBottom: 24,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    shadowColor: COLORS.primary,
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  challengeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    margin: -6,
    marginBottom: 18,
  },
  challengeButton: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: COLORS.glass,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    margin: 6,
  },
  challengeButtonText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  mainActions: {
    marginBottom: 12,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 12,
  },
  passButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.success,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  disabledButton: {
    opacity: 0.5,
  },
  buttonText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  passButtonText: {
    color: COLORS.success,
  },
  console: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    padding: 16,
    minHeight: 200,
    marginBottom: 24,
  },
  consoleHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  consoleText: {
    color: '#E2E8F0',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  statusSection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  card: {
    backgroundColor: COLORS.glass,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    width: '48%',
    marginBottom: 12,
  },
  label: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 13,
    color: COLORS.textPrimary,
    fontWeight: '700',
  },
});

const nativeBridge = NativeModules.NativeBridge as
  | NativeBridgeModule
  | undefined;

const EMBEDDING_FLOAT_COUNT = 128;

function readGlobalEngine(): OfflineFaceAuthGlobal | undefined {
  return (globalThis as {__offlineFaceAuth?: OfflineFaceAuthGlobal})
    .__offlineFaceAuth;
}

function readEmbedding(result: NativeFaceAuthResult): Float32Array {
  return result.embedding instanceof Float32Array
    ? result.embedding
    : new Float32Array();
}

function isUsableEmbedding(result: NativeFaceAuthResult): boolean {
  const embedding = readEmbedding(result);
  return (
    (result.embeddingValid === true || result.accepted === true) &&
    embedding.length === EMBEDDING_FLOAT_COUNT
  );
}

function formatResult(result: NativeFaceAuthResult): string {
  const embedding = readEmbedding(result);
  const embeddingArray = Array.from(embedding);
  const preview = isUsableEmbedding(result)
    ? embeddingArray.slice(0, 16).map(value => value.toFixed(6))
    : [];
  const livenessStateName =
    LIVENESS_STATE_NAMES[result.livenessState ?? 0] ?? 'UNKNOWN';
  const livenessChallengeName =
    LIVENESS_CHALLENGE_NAMES[result.livenessChallenge ?? 0] ?? 'UNKNOWN';
  return JSON.stringify(
    {
      accepted: result.accepted,
      externalModelProcessed: result.externalModelProcessed,
      timestampNs: result.timestampNs,
      sharpnessScore: result.sharpnessScore,
      faceMeshProcessed: result.faceMeshProcessed,
      mobileFaceNetProcessed: result.mobileFaceNetProcessed,
      droppedFrameCount: result.droppedFrameCount,
      replacedFrameCount: result.replacedFrameCount,
      faceMeshThreadCount: result.faceMeshThreadCount,
      mobileFaceNetThreadCount: result.mobileFaceNetThreadCount,
      livenessState: result.livenessState,
      livenessStateName,
      livenessChallenge: result.livenessChallenge,
      livenessChallengeName,
      faceDetected: result.faceDetected,
      ear: result.ear,
      mar: result.mar,
      yaw: result.yaw,
      pitch: result.pitch,
      roll: result.roll,
      framesProcessed: result.framesProcessed,
      framesWithFace: result.framesWithFace,
      embeddingValid: result.embeddingValid,
      embeddingFrameId: result.embeddingFrameId,
      usableEmbedding: isUsableEmbedding(result),
      embeddingLength: embeddingArray.length,
      nativeEmbeddingLength: result.embeddingLength,
      nativeEmbeddingByteLength: result.embeddingByteLength,
      embeddingPreview: preview,
    },
    null,
    2,
  );
}

function formatSmokeTestResult(result: SmokeTestResult): string {
  const lines = result.steps.map(step => {
    const status = step.passed ? 'PASS' : 'FAIL';
    return `${status} ${step.name}: ${step.detail}`;
  });

  return [
    `SQLCipher smoke test: ${result.passed ? 'PASS' : 'FAIL'}`,
    `Duration: ${result.durationMs}ms`,
    ...lines,
  ].join('\n');
}

function formatStorageSmokeTestResults(
  sqlCipherResult: SmokeTestResult,
  mmkvResult: SmokeTestResult,
): string {
  return [
    formatSmokeTestResult(sqlCipherResult),
    '',
    `MMKV smoke test: ${mmkvResult.passed ? 'PASS' : 'FAIL'}`,
    `Duration: ${mmkvResult.durationMs}ms`,
    ...mmkvResult.steps.map(step => {
      const status = step.passed ? 'PASS' : 'FAIL';
      return `${status} ${step.name}: ${step.detail}`;
    }),
  ].join('\n');
}

export default function App(): React.JSX.Element {
  const [enginePresent, setEnginePresent] = useState<boolean>(false);
  const [initialized, setInitialized] = useState<boolean>(false);
  const [frameProcessorPluginReady, setFrameProcessorPluginReady] =
    useState<boolean>(false);
  const [storageTestRunning, setStorageTestRunning] = useState<boolean>(false);
  const [previewReady, setPreviewReady] = useState<boolean>(false);
  const [consoleOutput, setConsoleOutput] = useState<string>(
    'Booting verification harness...',
  );

  useEffect(() => {
    const unsubscribe = startConnectivityWatcher();
    let currentAppState = AppState.currentState;
    let cancelled = false;

    const drainReceiptQueue = async () => {
      const receiptDrainResult = await ErasureService.drainPendingReceipts();
      if (receiptDrainResult.failed.length > 0) {
        console.warn(
          '[RECEIPT QUEUE] Failed to upload deletion receipts:',
          receiptDrainResult.failed,
        );
      }
    };

    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        const returningToForeground =
          currentAppState === 'background' || currentAppState === 'inactive';
        currentAppState = nextState;

        if (returningToForeground && nextState === 'active') {
          void drainReceiptQueue().catch((error) => {
            console.warn('[RECEIPT QUEUE] Foreground retry failed:', error);
          });
        }
      },
    );

    const startStorage = async () => {
      try {
        await openProductionDatabase();
        if (cancelled) {
          closeDatabase();
          return;
        }
        void getDevicePublicKey().catch((error) => {
          console.warn('[DEVICE KEY] Device identity initialization failed:', error);
        });
        WALCheckpointScheduler.start();
        const drainResult = await ErasureService.drainOfflineQueue();
        if (drainResult.failed.length > 0) {
          console.warn(
            '[ERASURE QUEUE] Failed to drain erasures:',
            drainResult.failed,
          );
        }
        await drainReceiptQueue();
      } catch (error) {
        console.warn('[App] Production database startup failed.', error);
      }
    };

    void startStorage();

    return () => {
      cancelled = true;
      WALCheckpointScheduler.stop();
      closeDatabase();
      appStateSubscription.remove();
      unsubscribe();
    };
  }, []);

  const refreshStatus = useCallback(() => {
    const engine = readGlobalEngine();
    const hasEngine = typeof engine?.getLatestResult === 'function';
    const isInitialized =
      hasEngine && typeof engine?.isInitialized === 'function'
        ? Boolean(engine.isInitialized())
        : false;
    const pluginAvailable = isNativeFrameProcessorPluginAvailable();

    setEnginePresent(hasEngine);
    setInitialized(isInitialized);
    setFrameProcessorPluginReady(pluginAvailable);
    return {engine, hasEngine, isInitialized, pluginAvailable};
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        if (nativeBridge == null) {
          throw new Error(
            'NativeBridge module is not registered on NativeModules',
          );
        }

        const pluginInstalled = await initializeFrameProcessorBridge(
          MODEL_PATH,
        );
        setFrameProcessorPluginReady(pluginInstalled);

        const deadline = Date.now() + 3000;
        while (!cancelled && Date.now() < deadline) {
          const status = refreshStatus();
          if (status.hasEngine) {
            setConsoleOutput(
              `Native engine injected.\nInitialized: ${String(
                status.isInitialized,
              )}\nFrame processor plugin: ${String(
                status.pluginAvailable,
              )}\nModel: ${MODEL_PATH}`,
            );
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        const status = refreshStatus();
        setConsoleOutput(
          status.hasEngine
            ? `Native engine injected.\nInitialized: ${String(
                status.isInitialized,
              )}\nFrame processor plugin: ${String(
                status.pluginAvailable,
              )}\nModel: ${MODEL_PATH}`
            : 'Native engine bootstrap completed, but __offlineFaceAuth is still missing from the JS runtime.',
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.stack ?? error.message : String(error);
        setConsoleOutput(`Bootstrap failure:\n${message}`);
      }
    };

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [refreshStatus]);

  const handleLoopback = useCallback(() => {
    try {
      const status = refreshStatus();
      if (!status.hasEngine || status.engine == null) {
        throw new Error('__offlineFaceAuth is not available on globalThis');
      }

      const result = status.engine.getLatestResult();
      const isTypedArrayReadable =
        result.embedding instanceof Float32Array &&
        result.embedding.length === EMBEDDING_FLOAT_COUNT;

      setConsoleOutput(
        `${formatResult(result)}\nFloat32Array readable: ${String(
          isTypedArrayReadable,
        )}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.stack ?? error.message : String(error);
      setConsoleOutput(`Loopback failure:\n${message}`);
    }
  }, [refreshStatus]);

  const handleStorageSmokeTest = useCallback(async () => {
    setStorageTestRunning(true);
    setConsoleOutput('Running SQLCipher + MMKV smoke tests...');

    try {
      const sqlCipherResult = await runSQLCipherSmokeTest();
      const mmkvResult = runMMKVSmokeTest();
      setConsoleOutput(
        formatStorageSmokeTestResults(sqlCipherResult, mmkvResult),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.stack ?? error.message : String(error);
      setConsoleOutput(`Storage smoke test failure:\n${message}`);
    } finally {
      setStorageTestRunning(false);
    }
  }, []);

  const handleMarkLivenessPassed = useCallback(async () => {
    try {
      if (nativeBridge?.setLivenessPassed == null) {
        throw new Error('NativeBridge.setLivenessPassed is unavailable');
      }

      await nativeBridge.setLivenessPassed(true);
      setConsoleOutput(
        'Liveness FSM marked PASS for Phase 1 verification. Keep the camera on your face for one frame, then tap Read Latest Native Result.',
      );
      refreshStatus();
    } catch (error) {
      const message =
        error instanceof Error ? error.stack ?? error.message : String(error);
      setConsoleOutput(`Liveness pass failure:\n${message}`);
    }
  }, [refreshStatus]);

  const handleChallenge = useCallback(
    async (challenge: NativeLivenessChallenge) => {
      try {
        await setNativeLivenessChallenge(challenge);
        setConsoleOutput(
          challenge === 'NONE'
            ? 'Liveness FSM reset. Center your face in the camera.'
            : `Started ${challenge} challenge. Watch the camera overlay for live state.`,
        );
        refreshStatus();
      } catch (error) {
        const message =
          error instanceof Error ? error.stack ?? error.message : String(error);
        setConsoleOutput(`Challenge failure:\n${message}`);
      }
    },
    [refreshStatus],
  );

  const summary = useMemo(
    () => [
      {label: 'Engine Presence', value: enginePresent ? 'Injected' : 'Missing'},
      {label: 'Camera Preview', value: previewReady ? 'Rendering' : 'Waiting'},
      {
        label: 'Frame Processor Plugin',
        value: frameProcessorPluginReady ? 'Registered' : 'Unavailable',
      },
      {
        label: 'Initialization State',
        value: initialized ? 'Initialized' : 'Not initialized',
      },
      {
        label: 'Storage Smoke Test',
        value: storageTestRunning ? 'Running' : 'Ready',
      },
      {label: 'Model Path', value: MODEL_PATH},
    ],
    [
      enginePresent,
      previewReady,
      frameProcessorPluginReady,
      initialized,
      storageTestRunning,
    ],
  );

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerSection}>
          <Text style={styles.logoText}>Nayan Secure</Text>
          <Text style={styles.header}>Offline FaceAuth Harness</Text>
          <Text style={styles.subheader}>
            Verifies JNI bootstrap, JSI injection, and zero-copy embedding
            access.
          </Text>
        </View>

        <View style={styles.cameraSection}>
          <CameraView
            key={
              frameProcessorPluginReady
                ? 'processor-ready'
                : 'processor-waiting'
            }
            isActive={frameProcessorPluginReady}
            onPreviewReady={() => setPreviewReady(true)}
          />
        </View>

        <View style={styles.challengeGrid}>
          <TouchableOpacity
            style={styles.challengeButton}
            onPress={() => handleChallenge('BLINK')}>
            <Text style={styles.challengeButtonText}>Start Blink</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.challengeButton}
            onPress={() => handleChallenge('TURN_LEFT')}>
            <Text style={styles.challengeButtonText}>Start Turn Left</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.challengeButton}
            onPress={() => handleChallenge('TURN_RIGHT')}>
            <Text style={styles.challengeButtonText}>Start Turn Right</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.challengeButton}
            onPress={() => handleChallenge('NONE')}>
            <Text style={[styles.challengeButtonText, {color: COLORS.primary}]}>
              Reset Liveness
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.mainActions}>
          <TouchableOpacity style={styles.button} onPress={handleLoopback}>
            <Text style={styles.buttonText}>Read Latest Native Result</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.passButton]}
            onPress={handleMarkLivenessPassed}>
            <Text style={[styles.buttonText, styles.passButtonText]}>
              Mark Liveness Passed
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            disabled={storageTestRunning}
            style={[
              styles.button,
              styles.secondaryButton,
              storageTestRunning && styles.disabledButton,
            ]}
            onPress={handleStorageSmokeTest}>
            <Text style={[styles.buttonText, {color: COLORS.textSecondary}]}>
              {storageTestRunning
                ? 'Running Storage Smoke Tests'
                : 'Run Storage Smoke Tests'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.console}>
          <Text style={styles.consoleHeader}>System Console</Text>
          <Text style={styles.consoleText}>{consoleOutput}</Text>
        </View>

        <View style={styles.statusSection}>
          {summary.map(item => (
            <View key={item.label} style={styles.card}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.value} numberOfLines={1} ellipsizeMode="tail">
                {item.value}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
