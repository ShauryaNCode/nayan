import React, {useEffect, useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
} from 'react-native-vision-camera';

import {LivenessRing, LivenessRingState} from '../overlay/LivenessRing';

type CameraViewProps = {
  isActive?: boolean;
  ringState?: LivenessRingState;
  onPreviewReady?: () => void;
};

export function CameraView({
  isActive = true,
  ringState = 'idle',
  onPreviewReady,
}: CameraViewProps): React.JSX.Element {
  const device = useCameraDevice('front');
  const format = useCameraFormat(device, [
    {videoResolution: {width: 1280, height: 720}},
    {fps: 30},
  ]);
  const {hasPermission, requestPermission} = useCameraPermission();

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

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
        onInitialized={onPreviewReady}
      />
      <LivenessRing state={ringState} />
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
