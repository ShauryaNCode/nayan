import React, {useEffect, useRef, useState} from 'react';
import {Animated, StyleSheet, View} from 'react-native';
import {Canvas, Circle, Group} from '@shopify/react-native-skia';

export type LivenessRingState =
  | 'idle'
  | 'detected'
  | 'challenge'
  | 'fail'
  | 'pass';

type LivenessRingProps = {
  state: LivenessRingState;
};

const RING_COLORS: Record<LivenessRingState, string> = {
  idle: '#38bdf8',
  detected: '#22c55e',
  challenge: '#f59e0b',
  fail: '#ef4444',
  pass: '#4ade80',
};

export function LivenessRing({state}: LivenessRingProps): React.JSX.Element {
  const pulse = useRef(new Animated.Value(0)).current;
  const [layout, setLayout] = useState({width: 0, height: 0});

  useEffect(() => {
    pulse.stopAnimation();
    pulse.setValue(0);

    if (state !== 'idle' && state !== 'challenge' && state !== 'pass') {
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: state === 'challenge' ? 420 : 850,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: state === 'challenge' ? 420 : 850,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, state]);

  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: state === 'pass' ? [1, 1.08] : [0.96, 1.04],
  });
  const opacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: state === 'detected' || state === 'fail' ? [1, 1] : [0.55, 1],
  });

  const size = Math.min(layout.width, layout.height);
  const radius = Math.max(0, size * 0.34);

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.root, {opacity, transform: [{scale}]}]}
      onLayout={event => setLayout(event.nativeEvent.layout)}>
      {size > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Group style="stroke" strokeWidth={5}>
            <Circle
              cx={layout.width / 2}
              cy={layout.height / 2}
              r={radius}
              color={RING_COLORS[state]}
            />
          </Group>
        </Canvas>
      ) : null}
      <View style={[styles.corner, styles.topLeft]} />
      <View style={[styles.corner, styles.topRight]} />
      <View style={[styles.corner, styles.bottomLeft]} />
      <View style={[styles.corner, styles.bottomRight]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  corner: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderColor: 'rgba(248, 250, 252, 0.8)',
  },
  topLeft: {
    top: 18,
    left: 18,
    borderTopWidth: 2,
    borderLeftWidth: 2,
  },
  topRight: {
    top: 18,
    right: 18,
    borderTopWidth: 2,
    borderRightWidth: 2,
  },
  bottomLeft: {
    bottom: 18,
    left: 18,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
  },
  bottomRight: {
    right: 18,
    bottom: 18,
    borderRightWidth: 2,
    borderBottomWidth: 2,
  },
});
