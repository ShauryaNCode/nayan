export const LIVENESS_STATES = ['IDLE', 'DETECTED', 'CHALLENGE_ACTIVE', 'LIVENESS_PASS', 'LIVENESS_FAIL'] as const;
export const LIVENESS_CHALLENGES = ['NONE', 'BLINK', 'SMILE', 'TURN_LEFT', 'TURN_RIGHT'] as const;

export const LIVENESS_TIMEOUTS_MS = {
  blinkWindow: 800,
  smileSustain: 600,
  turnWindow: 2000,
  challengeTimeout: 4000,
} as const;
