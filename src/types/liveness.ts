export type LivenessState = 'IDLE' | 'DETECTED' | 'CHALLENGE_ACTIVE' | 'LIVENESS_PASS' | 'LIVENESS_FAIL';
export type ChallengeType = 'NONE' | 'BLINK' | 'SMILE' | 'TURN_LEFT' | 'TURN_RIGHT';

export type FaceData = {
  faceDetected: boolean;
  ear: number;
  mar: number;
  yaw: number;
  pitch: number;
  roll: number;
};

export type LivenessTelemetry = FaceData & {
  state: LivenessState;
  challenge: ChallengeType;
  inferenceMs: number;
  fps: number;
  ramMb: number;
  passiveTextureOk: boolean;
  passiveDepthOk: boolean;
  passiveDepthRatio: number;
};
