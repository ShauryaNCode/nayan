import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

import type {ChallengeType, LivenessState} from '../../types/liveness';

type ChallengeTextProps = {
  state: LivenessState;
  challenge: ChallengeType;
  faceDetected: boolean;
};

const CHALLENGE_COPY: Record<ChallengeType, string> = {
  NONE: 'Center your face',
  BLINK: 'Blink now',
  SMILE: 'Smile',
  TURN_LEFT: 'Turn left',
  TURN_RIGHT: 'Turn right',
};

const STATE_COPY: Record<LivenessState, string> = {
  IDLE: 'Waiting',
  DETECTED: 'Face detected',
  CHALLENGE_ACTIVE: 'Challenge active',
  LIVENESS_PASS: 'Liveness passed',
  LIVENESS_FAIL: 'Liveness failed',
};

export function ChallengeText({
  state,
  challenge,
  faceDetected,
}: ChallengeTextProps): React.JSX.Element {
  const title = faceDetected ? CHALLENGE_COPY[challenge] : 'No face detected';
  const subtitle = faceDetected ? STATE_COPY[state] : 'Move into frame';

  return (
    <View pointerEvents="none" style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    minHeight: 58,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.28)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  title: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 3,
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});
