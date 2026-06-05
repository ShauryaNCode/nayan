import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  NativeModules,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {startConnectivityWatcher} from './sync/connectivity/ConnectivityWatcher';
import {
  closeDatabase,
  openProductionDatabase,
} from './storage/database/DatabaseManager';
import {WALCheckpointScheduler} from './storage/WALCheckpointScheduler';

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

type OfflineFaceAuthResult = {
  accepted: boolean;
  externalModelProcessed?: boolean;
  timestampNs: number;
  sharpnessScore: number;
  faceMeshProcessed?: boolean;
  mobileFaceNetProcessed?: boolean;
  droppedFrameCount?: number;
  replacedFrameCount?: number;
  faceMeshThreadCount?: number;
  mobileFaceNetThreadCount?: number;
  livenessState?: number;
  livenessChallenge?: number;
  faceDetected?: boolean;
  ear?: number;
  mar?: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
  framesProcessed?: number;
  framesWithFace?: number;
  embeddingValid?: boolean;
  embeddingFrameId?: number;
  embedding: Float32Array;
  embeddingPreview?: number[];
  embeddingLength?: number;
  embeddingByteLength?: number;
};

type OfflineFaceAuthGlobal = {
  getLatestResult: () => OfflineFaceAuthResult;
  isInitialized: () => boolean;
  setLivenessState?: (state: number) => boolean;
  setLivenessChallenge?: (challenge: number) => boolean;
};

type NativeBridgeModule = {
  initializeEngine: (modelPath?: string) => Promise<void>;
  ensureJsiInstalled: () => Promise<boolean>;
  setLivenessPassed?: (passed: boolean) => Promise<void>;
  setLivenessState?: (state: string) => Promise<void>;
  setLivenessChallenge?: (challenge: string) => Promise<void>;
};

type NativeChallenge = 'NONE' | 'BLINK' | 'SMILE' | 'TURN_LEFT' | 'TURN_RIGHT';

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

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0f172a'},
  scrollContent: {padding: 24},
  header: {fontSize: 28, fontWeight: '700', color: '#f8fafc', marginBottom: 8},
  subheader: {fontSize: 15, color: '#cbd5e1', marginBottom: 24},
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  cameraSection: {
    marginBottom: 16,
  },
  cameraLabel: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  label: {fontSize: 13, color: '#94a3b8', marginBottom: 6},
  value: {fontSize: 16, color: '#f8fafc', fontWeight: '600'},
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    marginBottom: 16,
  },
  secondaryButton: {
    backgroundColor: '#0f766e',
  },
  passButton: {
    backgroundColor: '#7c3aed',
  },
  challengeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  challengeButton: {
    flexGrow: 1,
    flexBasis: '48%',
    backgroundColor: '#334155',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  challengeButtonText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '800',
  },
  disabledButton: {
    opacity: 0.6,
  },
  buttonText: {color: '#eff6ff', fontSize: 16, fontWeight: '700'},
  console: {
    backgroundColor: '#020617',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    minHeight: 260,
  },
  statusSection: {
    marginTop: 16,
  },
  consoleText: {
    color: '#bfdbfe',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 19,
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

function readEmbedding(result: OfflineFaceAuthResult): Float32Array {
  return result.embedding instanceof Float32Array
    ? result.embedding
    : new Float32Array();
}

function isUsableEmbedding(result: OfflineFaceAuthResult): boolean {
  const embedding = readEmbedding(result);
  return (
    (result.embeddingValid === true || result.accepted === true) &&
    embedding.length === EMBEDDING_FLOAT_COUNT
  );
}

function formatResult(result: OfflineFaceAuthResult): string {
  const embedding = readEmbedding(result);
  const embeddingArray = Array.from(embedding);
  const preview = isUsableEmbedding(result)
    ? embeddingArray.slice(0, 16).map((value) => value.toFixed(6))
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
  const lines = result.steps.map((step) => {
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
    ...mmkvResult.steps.map((step) => {
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
  const [consoleOutput, setConsoleOutput] = useState<string>('Booting verification harness...');

  useEffect(() => {
    const unsubscribe = startConnectivityWatcher();
    let cancelled = false;

    const startStorage = async () => {
      try {
        await openProductionDatabase();
        if (cancelled) {
          closeDatabase();
          return;
        }
        WALCheckpointScheduler.start();
      } catch (error) {
        console.warn('[App] Production database startup failed.', error);
      }
    };

    void startStorage();

    return () => {
      cancelled = true;
      WALCheckpointScheduler.stop();
      closeDatabase();
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

        const pluginInstalled = await initializeFrameProcessorBridge(MODEL_PATH);
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
          await new Promise((resolve) => setTimeout(resolve, 50));
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
    async (challenge: NativeChallenge) => {
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
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}
      >
        <Text style={styles.header}>Offline FaceAuth Harness</Text>
        <Text style={styles.subheader}>
          Verifies JNI bootstrap, JSI injection, and zero-copy embedding access.
        </Text>

        <View style={styles.cameraSection}>
          <Text style={styles.cameraLabel}>Front Camera Preview</Text>
          <CameraView
            key={frameProcessorPluginReady ? 'processor-ready' : 'processor-waiting'}
            isActive={frameProcessorPluginReady}
            onPreviewReady={() => setPreviewReady(true)}
          />
        </View>

        <View style={styles.challengeGrid}>
          <TouchableOpacity
            style={styles.challengeButton}
            onPress={() => handleChallenge('BLINK')}
          >
            <Text style={styles.challengeButtonText}>Start Blink</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.challengeButton}
            onPress={() => handleChallenge('TURN_LEFT')}
          >
            <Text style={styles.challengeButtonText}>Start Turn Left</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.challengeButton}
            onPress={() => handleChallenge('TURN_RIGHT')}
          >
            <Text style={styles.challengeButtonText}>Start Turn Right</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.challengeButton}
            onPress={() => handleChallenge('NONE')}
          >
            <Text style={styles.challengeButtonText}>Reset Liveness</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.button} onPress={handleLoopback}>
          <Text style={styles.buttonText}>Read Latest Native Result</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.passButton]}
          onPress={handleMarkLivenessPassed}
        >
          <Text style={styles.buttonText}>Mark Liveness Passed</Text>
        </TouchableOpacity>

        <TouchableOpacity
          disabled={storageTestRunning}
          style={[
            styles.button,
            styles.secondaryButton,
            storageTestRunning && styles.disabledButton,
          ]}
          onPress={handleStorageSmokeTest}
        >
          <Text style={styles.buttonText}>
            {storageTestRunning
              ? 'Running Storage Smoke Tests'
              : 'Run Storage Smoke Tests'}
          </Text>
        </TouchableOpacity>

        <View style={styles.console}>
          <Text style={styles.consoleText}>{consoleOutput}</Text>
        </View>

        <View style={styles.statusSection}>
          {summary.map((item) => (
            <View key={item.label} style={styles.card}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.value}>{item.value}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
