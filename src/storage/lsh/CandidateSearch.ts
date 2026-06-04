import {LSHIndex, type LSHCandidate} from '../LSHIndex';

export type {LSHCandidate};

export function findLshCandidates(
  liveEmbedding: Float32Array,
): Promise<LSHCandidate[]> {
  return LSHIndex.query({liveEmbedding});
}
