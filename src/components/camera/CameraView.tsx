import React, {useEffect, useMemo, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';

import {getLatestFrameResult, getNativeFrameProcessorPlugin} from './FrameProcessorBridge';
import {LivenessHaptics} from '../../liveness/haptics/HapticFeedback';
import type {ChallengeType, LivenessState, LivenessTelemetry} from '../../types/liveness';
import {ChallengeText} from '../overlay/ChallengeText';
import {DebugOverlay} from '../overlay/DebugOverlay';
import {LivenessRing, LivenessRingState} from '../overlay/LivenessRing';

type CameraViewProps = {
  isActive?: boolean;
  ringState?: LivenessRingState;
  showTelemetry?: boolean;
  onPreviewReady?: () => void;
};

const STATE_TO_RING: Record<string, LivenessRingState> = {
  IDLE: 'idle',
  DETECTED: 'detected',
  CHALLENGE_ACTIVE: 'challenge',
  LIVENESS_FAIL: 'fail',
  LIVENESS_PASS: 'pass',
};

const LIVENESS_STATE_CODES: readonly LivenessState[] = [
  'IDLE',
  'DETECTED',
  'CHALLENGE_ACTIVE',
  'LIVENESS_PASS',
  'LIVENESS_FAIL',
];

const LIVENESS_CHALLENGE_CODES: readonly ChallengeType[] = [
  'NONE',
  'BLINK',
  'SMILE',
  'TURN_LEFT',
  'TURN_RIGHT',
];

const INITIAL_TELEMETRY: LivenessTelemetry = {
  state: 'IDLE',
  challenge: 'NONE',
  faceDetected: false,
  ear: 0,
  mar: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  inferenceMs: 0,
  fps: 0,
  ramMb: 0,
  passiveTextureOk: true,
  passiveDepthOk: true,
  passiveDepthRatio: 0,
};

function useNativeLivenessTelemetry(
  isActive: boolean,
): LivenessTelemetry {
  const [telemetry, setTelemetry] = useState<LivenessTelemetry>(INITIAL_TELEMETRY);
  const lastFrameAt = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }

    const interval = setInterval(() => {
      const latest = getLatestFrameResult();
      const now = Date.now();
      const previous = lastFrameAt.current;
      lastFrameAt.current = now;
      const fps = previous == null || now <= previous ? 0 : 1000 / (now - previous);

      if (latest != null) {
        setTelemetry({
          state: LIVENESS_STATE_CODES[latest.livenessState ?? 0] ?? 'IDLE',
          challenge:
            LIVENESS_CHALLENGE_CODES[latest.livenessChallenge ?? 0] ?? 'NONE',
          faceDetected: latest.faceDetected,
          ear: latest.ear,
          mar: latest.mar,
          yaw: latest.yaw,
          pitch: latest.pitch,
          roll: latest.roll,
          inferenceMs: latest.inferenceMs ?? 0,
          fps,
          ramMb: latest.ramMb ?? 0,
          passiveTextureOk: latest.passiveTextureOk ?? true,
          passiveDepthOk: latest.passiveDepthOk ?? true,
          passiveDepthRatio: latest.passiveDepthRatio ?? 0,
        });
      }
    }, 250);

    return () => clearInterval(interval);
  }, [isActive]);

  return telemetry;
}

export function CameraView({
  isActive = true,
  ringState,
  showTelemetry = true,
  onPreviewReady,
}: CameraViewProps): React.JSX.Element {
  const device = useCameraDevice('front');
  const format = useCameraFormat(device, [
    {videoResolution: {width: 1280, height: 720}},
    {fps: 30},
  ]);
  const {hasPermission, requestPermission} = useCameraPermission();
  const nayanFrameProcessorPlugin = getNativeFrameProcessorPlugin();
  const telemetry = useNativeLivenessTelemetry(isActive && hasPermission);
  const previousState = useRef(telemetry.state);
  const previousChallenge = useRef(telemetry.challenge);
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    nayanFrameProcessorPlugin?.call(frame);
  }, [nayanFrameProcessorPlugin]);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    if (telemetry.challenge !== previousChallenge.current) {
      if (telemetry.challenge === 'BLINK') {
        LivenessHaptics.blink();
      } else if (
        telemetry.challenge === 'TURN_LEFT' ||
        telemetry.challenge === 'TURN_RIGHT'
      ) {
        LivenessHaptics.turn();
      }
      previousChallenge.current = telemetry.challenge;
    }

    if (telemetry.state !== previousState.current) {
      if (telemetry.state === 'LIVENESS_PASS') {
        LivenessHaptics.pass();
      } else if (telemetry.state === 'LIVENESS_FAIL') {
        LivenessHaptics.fail();
      }
      previousState.current = telemetry.state;
    }
  }, [telemetry.challenge, telemetry.state]);

  const statusText = useMemo(() => {
    if (!hasPermission) {
      return 'Camera permission is required to render the preview.';
    }
    if (device == null) {
      return 'No front camera detected on this device.';
    }
    return null;
  }, [device, hasPermission]);

  if (statusText != null || device == null) {
    return (
      <View style={[styles.root, styles.fallback]}>
        <Text style={styles.fallbackText}>{statusText}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive={isActive && hasPermission}
        frameProcessor={frameProcessor}
        onInitialized={onPreviewReady}
      />
      <LivenessRing state={ringState ?? STATE_TO_RING[telemetry.state] ?? 'idle'} />
      <ChallengeText
        state={telemetry.state}
        challenge={telemetry.challenge}
        faceDetected={telemetry.faceDetected}
      />
      {showTelemetry ? <DebugOverlay telemetry={telemetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    aspectRatio: 3 / 4,
    overflow: 'hidden',
    backgroundColor: '#020617',
    borderRadius: 16,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  fallbackText: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
