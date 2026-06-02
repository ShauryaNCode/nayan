import {LIVENESS_CHALLENGES, LIVENESS_STATES} from './states';
import type {ChallengeType, LivenessState} from '../../types/liveness';

export function decodeLivenessState(code: number | undefined): LivenessState {
  return LIVENESS_STATES[code ?? 0] ?? 'IDLE';
}

export function decodeLivenessChallenge(code: number | undefined): ChallengeType {
  return LIVENESS_CHALLENGES[code ?? 0] ?? 'NONE';
}
