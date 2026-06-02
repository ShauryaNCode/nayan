import React, {useMemo, useState} from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type {LivenessTelemetry} from '../../types/liveness';

type DebugOverlayProps = {
  telemetry: LivenessTelemetry;
  style?: StyleProp<ViewStyle>;
};

function formatNumber(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '0.0';
}

export function DebugOverlay({
  telemetry,
  style,
}: DebugOverlayProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(true);
  const rows = useMemo(
    () => [
      ['Inference MS', formatNumber(telemetry.inferenceMs, 2)],
      ['FPS', formatNumber(telemetry.fps, 1)],
      ['RAM', `${formatNumber(telemetry.ramMb, 0)} MB`],
      ['EAR', formatNumber(telemetry.ear, 3)],
      ['MAR', formatNumber(telemetry.mar, 3)],
      ['Yaw', formatNumber(telemetry.yaw, 1)],
      ['Texture', telemetry.passiveTextureOk ? 'OK' : 'FAIL'],
      ['Depth', telemetry.passiveDepthOk ? 'OK' : 'FAIL'],
    ],
    [telemetry],
  );

  return (
    <View style={[styles.root, style]}>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => setCollapsed(value => !value)}
        style={styles.header}>
        <Text style={styles.headerText}>Telemetry</Text>
        <Text style={styles.headerText}>{collapsed ? '+' : '-'}</Text>
      </TouchableOpacity>
      {!collapsed ? (
        <View style={styles.body}>
          {rows.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value}>{value}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 156,
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: 'rgba(2, 6, 23, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.25)',
  },
  header: {
    minHeight: 34,
    paddingHorizontal: 10,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
  },
  body: {
    paddingHorizontal: 10,
    paddingBottom: 8,
    gap: 5,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    color: '#94a3b8',
    fontSize: 11,
  },
  value: {
    color: '#e2e8f0',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
});
