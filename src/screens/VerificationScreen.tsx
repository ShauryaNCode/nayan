import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  TouchableOpacity,
  Dimensions,
  SafeAreaView,
  StatusBar
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import {
  getLatestFrameResult,
  getNativeFrameProcessorPlugin,
  setNativeLivenessState
} from '../components/camera/FrameProcessorBridge';

const { width, height } = Dimensions.get('window');

// --- Design System Tokens ---
const COLORS = {
  background: '#050B1A', // Deep Navy
  primary: '#00BFFF',    // Electric Blue
  success: '#00FF88',    // Success Green
  error: '#FF4D4D',      // Error Red
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.7)',
  glassBackground: 'rgba(255, 255, 255, 0.05)',
  glassBorder: 'rgba(255, 255, 255, 0.1)',
};

const TYPOGRAPHY = {
  header: { fontSize: 24, fontWeight: '700' as const, color: COLORS.textPrimary, letterSpacing: 0.5 },
  title: { fontSize: 20, fontWeight: '600' as const, color: COLORS.textPrimary },
  subtitle: { fontSize: 14, fontWeight: '400' as const, color: COLORS.textSecondary },
  instruction: { fontSize: 18, fontWeight: '500' as const, color: COLORS.textPrimary },
  buttonText: { fontSize: 16, fontWeight: '600' as const, color: COLORS.background },
  caption: { fontSize: 12, fontWeight: '400' as const, color: COLORS.textSecondary },
};

const LIVENESS_STATE_CODES = [
  'IDLE',
  'DETECTED',
  'CHALLENGE_ACTIVE',
  'LIVENESS_PASS',
  'LIVENESS_FAIL',
] as const;

const LIVENESS_CHALLENGE_CODES = [
  'NONE',
  'BLINK',
  'SMILE',
  'TURN_LEFT',
  'TURN_RIGHT',
] as const;

const STAGES = ['Face', 'Blink', 'Head Turn', 'Verify'];

export default function VerificationScreen() {
  const [engineState, setEngineState] = useState<{
    state: typeof LIVENESS_STATE_CODES[number];
    challenge: typeof LIVENESS_CHALLENGE_CODES[number];
    failReason?: string;
  }>({
    state: 'IDLE',
    challenge: 'NONE'
  });
  const [progressIndex, setProgressIndex] = useState(0);

  const scanAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // --- Camera Setup ---
  const device = useCameraDevice('front');
  const format = useCameraFormat(device, [
    {videoResolution: {width: 640, height: 480}},
    {fps: 30},
  ]);
  const {hasPermission, requestPermission} = useCameraPermission();
  const nayanFrameProcessorPlugin = getNativeFrameProcessorPlugin();

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    nayanFrameProcessorPlugin?.call(frame);
  }, [nayanFrameProcessorPlugin]);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // --- Engine Telemetry Polling ---
  useEffect(() => {
    if (!hasPermission) return;
    
    const interval = setInterval(() => {
      const latest = getLatestFrameResult();
      if (latest != null) {
        const nextState = LIVENESS_STATE_CODES[latest.livenessState ?? 0] ?? 'IDLE';
        const nextChallenge = LIVENESS_CHALLENGE_CODES[latest.livenessChallenge ?? 0] ?? 'NONE';
        
        let failReason = undefined;
        if (nextState === 'LIVENESS_FAIL') {
          if (!latest.passiveTextureOk || !latest.passiveDepthOk) {
            failReason = 'Spoof attempt detected';
          } else if (!latest.faceDetected) {
            failReason = 'Face not detected during challenge';
          } else {
            failReason = 'Challenge failed or timed out';
          }
        }

        setEngineState(prev => {
          if (prev.state === nextState && prev.challenge === nextChallenge && prev.failReason === failReason) {
            return prev;
          }
          return { state: nextState, challenge: nextChallenge, failReason };
        });
      }
    }, 100);

    return () => clearInterval(interval);
  }, [hasPermission]);

  // --- Map Progress ---
  useEffect(() => {
    const { state, challenge } = engineState;
    if (state === 'IDLE') {
      setProgressIndex(0);
    } else if (state === 'DETECTED' && progressIndex === 0) {
      setProgressIndex(0);
    } else if (state === 'CHALLENGE_ACTIVE' && challenge === 'BLINK') {
      setProgressIndex(1);
    } else if (state === 'CHALLENGE_ACTIVE' && (challenge === 'TURN_LEFT' || challenge === 'TURN_RIGHT' || challenge === 'SMILE')) {
      setProgressIndex(2);
    } else if (state === 'DETECTED' && progressIndex >= 2) {
      setProgressIndex(3);
    } else if (state === 'LIVENESS_PASS') {
      setProgressIndex(4);
    }
  }, [engineState, progressIndex]);

  // --- Visual Animations ---
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1200,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        })
      ])
    ).start();
    
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, {
          toValue: 1,
          duration: 2500,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(scanAnim, {
          toValue: 0,
          duration: 2500,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        })
      ])
    ).start();
  }, [pulseAnim, scanAnim]);

  const handleRetry = async () => {
    try {
      await setNativeLivenessState('IDLE');
    } catch (e) {
      // Ignore if native bridge fails
    }
    setEngineState({ state: 'IDLE', challenge: 'NONE' });
    setProgressIndex(0);
  };

  const scanTranslateY = scanAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, height * 0.55],
  });

  const { state, challenge, failReason } = engineState;

  // --- Real-Time Instruction Mapping ---
  let instruction = "Position your face in frame";
  if (state === 'IDLE') {
    instruction = "Position your face in frame";
  } else if (state === 'DETECTED') {
    if (progressIndex >= 2) instruction = "Verifying liveness...";
    else instruction = "Face detected";
  } else if (state === 'CHALLENGE_ACTIVE') {
    if (challenge === 'BLINK') instruction = "Blink once";
    else if (challenge === 'TURN_LEFT' || challenge === 'TURN_RIGHT') instruction = "Turn your head";
    else if (challenge === 'SMILE') instruction = "Smile";
    else instruction = "Hold still";
  }

  const isOverlayVisible = state === 'LIVENESS_PASS' || state === 'LIVENESS_FAIL';
  const isPass = state === 'LIVENESS_PASS';

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      
      {/* Header Area */}
      <View style={styles.header}>
        <Text style={styles.logo}>NAYAN</Text>
        <Text style={styles.title}>Liveness Verification</Text>
        <Text style={styles.subtitle}>AI-Powered Face Authentication</Text>
      </View>

      {/* Main Camera Section */}
      <View style={styles.cameraSection}>
        {hasPermission && device != null ? (
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            format={format}
            fps={30}
            pixelFormat="yuv"
            isActive={true}
            frameProcessor={frameProcessor}
          />
        ) : (
          <View style={styles.mockCameraFeed} />
        )}

        {/* Bounding Guide & Scanning Target */}
        <View style={styles.boundingGuide}>
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />
          
          <Animated.View style={[styles.faceMeshRing, { transform: [{ scale: pulseAnim }] }]}>
            <View style={styles.innerRing} />
            <View style={styles.coreRing} />
          </Animated.View>
        </View>

        {/* Animated Scanning Laser Line */}
        <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanTranslateY }] }]} />

        {/* Glassmorphic Live Challenge Panel at Bottom of Camera */}
        {!isOverlayVisible && (
          <View style={styles.glassPanel}>
            <Text style={styles.instructionText}>{instruction}</Text>
            
            <View style={styles.progressContainer}>
              <View style={styles.progressLineContainer}>
                {STAGES.map((stage, index) => {
                  const isCompleted = index < progressIndex;
                  const isActive = index === progressIndex;
                  const isLast = index === STAGES.length - 1;

                  return (
                    <React.Fragment key={`frag-${stage}`}>
                      <View style={[
                        styles.progressDot,
                        isCompleted ? styles.progressDotCompleted : isActive ? styles.progressDotActive : styles.progressDotPending,
                        isCompleted ? styles.glowEffectSuccess : isActive ? styles.glowEffectPrimary : null
                      ]} />
                      {!isLast && (
                         <View style={[
                           styles.progressLine,
                           isCompleted ? styles.progressLineCompleted : styles.progressLinePending
                         ]} />
                      )}
                    </React.Fragment>
                  );
                })}
              </View>
              <View style={styles.progressLabelsContainer}>
                 {STAGES.map((stage, index) => (
                   <Text key={`label-${stage}`} style={[
                     styles.progressLabel,
                     index < progressIndex ? styles.progressLabelCompleted : 
                     index === progressIndex ? styles.progressLabelActive : styles.progressLabelPending
                   ]}>
                     {stage}
                   </Text>
                 ))}
              </View>
            </View>
          </View>
        )}
      </View>

      {/* Full Screen Pass / Fail Overlay */}
      {isOverlayVisible && (
        <View style={[styles.overlay, isPass ? styles.overlayPass : styles.overlayFail]}>
          <View style={styles.overlayContent}>
            <Text style={styles.overlayIcon}>{isPass ? '✅' : '❌'}</Text>
            <Text style={styles.overlayTitle}>
              {isPass ? 'Liveness Verification Passed' : 'Liveness Verification Failed'}
            </Text>
            
            <Text style={styles.overlaySubtitle}>
              {isPass 
                ? 'Identity confirmed as a live human.' 
                : (failReason ?? 'Possible reasons:\n• Face not detected\n• Blink challenge failed\n• Head-turn challenge failed\n• Spoof attempt detected')
              }
            </Text>

            <TouchableOpacity 
              style={[styles.button, isPass ? styles.buttonPass : styles.buttonFail]}
              onPress={handleRetry}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>{isPass ? 'Verify Again' : 'Retry'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingTop: 20,
    paddingHorizontal: 24,
    paddingBottom: 16,
    alignItems: 'center',
    zIndex: 10,
  },
  logo: {
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 6,
    marginBottom: 6,
  },
  title: {
    ...TYPOGRAPHY.header,
    marginBottom: 4,
  },
  subtitle: {
    ...TYPOGRAPHY.subtitle,
  },
  cameraSection: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 24,
    borderRadius: 32,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#0a1128',
    borderWidth: 2,
    borderColor: 'rgba(0, 191, 255, 0.2)',
  },
  mockCameraFeed: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0A101F',
    opacity: 0.8,
  },
  boundingGuide: {
    position: 'absolute',
    top: '12%',
    left: '15%',
    right: '15%',
    bottom: '30%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  corner: {
    position: 'absolute',
    width: 35,
    height: 35,
    borderColor: COLORS.primary,
  },
  topLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 20 },
  topRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 20 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 20 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 20 },
  faceMeshRing: {
    width: 180,
    height: 240,
    borderRadius: 90,
    borderWidth: 1,
    borderColor: 'rgba(0, 191, 255, 0.3)',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerRing: {
    width: 140,
    height: 190,
    borderRadius: 70,
    borderWidth: 1,
    borderColor: 'rgba(0, 191, 255, 0.15)',
  },
  coreRing: {
    position: 'absolute',
    width: 80,
    height: 110,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: 'rgba(0, 191, 255, 0.1)',
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 20,
    height: 3,
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 15,
    elevation: 8,
  },
  glassPanel: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    backgroundColor: COLORS.glassBackground,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    alignItems: 'center',
  },
  instructionText: {
    ...TYPOGRAPHY.instruction,
    textAlign: 'center',
    marginBottom: 20,
  },
  progressContainer: {
    width: '100%',
  },
  progressLineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 5,
  },
  progressDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    zIndex: 2,
  },
  progressDotCompleted: { backgroundColor: COLORS.success },
  progressDotActive: { backgroundColor: COLORS.primary },
  progressDotPending: { backgroundColor: 'rgba(255, 255, 255, 0.2)' },
  progressLine: {
    flex: 1,
    height: 2,
    marginHorizontal: -2,
    zIndex: 1,
  },
  progressLineCompleted: { backgroundColor: COLORS.success },
  progressLinePending: { backgroundColor: 'rgba(255, 255, 255, 0.1)' },
  progressLabelsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressLabel: {
    ...TYPOGRAPHY.caption,
    width: 65,
    textAlign: 'center',
  },
  progressLabelCompleted: { color: COLORS.success, fontWeight: '500' },
  progressLabelActive: { color: COLORS.primary, fontWeight: '700' },
  progressLabelPending: { color: COLORS.textSecondary },
  glowEffectPrimary: {
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 6,
  },
  glowEffectSuccess: {
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 6,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 100,
  },
  overlayPass: { backgroundColor: 'rgba(5, 11, 26, 0.96)' },
  overlayFail: { backgroundColor: 'rgba(5, 11, 26, 0.96)' },
  overlayContent: {
    alignItems: 'center',
    backgroundColor: COLORS.glassBackground,
    padding: 32,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    width: '100%',
  },
  overlayIcon: {
    fontSize: 72,
    marginBottom: 24,
  },
  overlayTitle: {
    ...TYPOGRAPHY.header,
    textAlign: 'center',
    marginBottom: 16,
    color: COLORS.textPrimary,
  },
  overlaySubtitle: {
    ...TYPOGRAPHY.subtitle,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  button: {
    width: '100%',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
  },
  buttonPass: { backgroundColor: COLORS.success },
  buttonFail: { backgroundColor: COLORS.error },
  buttonText: {
    ...TYPOGRAPHY.buttonText,
    fontSize: 18,
  },
});
