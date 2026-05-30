import HapticFeedback, {
  HapticFeedbackTypes,
} from 'react-native-haptic-feedback';

const HAPTIC_OPTIONS = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

function trigger(type: HapticFeedbackTypes): void {
  HapticFeedback.trigger(type, HAPTIC_OPTIONS);
}

export const LivenessHaptics = {
  blink(): void {
    trigger(HapticFeedbackTypes.impactLight);
    setTimeout(() => trigger(HapticFeedbackTypes.impactLight), 90);
  },
  turn(): void {
    trigger(HapticFeedbackTypes.impactHeavy);
  },
  pass(): void {
    trigger(HapticFeedbackTypes.notificationSuccess);
  },
  fail(): void {
    trigger(HapticFeedbackTypes.notificationError);
  },
};
