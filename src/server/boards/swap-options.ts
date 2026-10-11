/**
 * Kandidaterne ved "udskift" i admins board-editor, med kompetence-delta pr. kandidat (ADR 0062).
 * BEVIDST REN som ./composition's planlægning: ingen Supabase-, env- eller React-afhængigheder.
 *
 * Det er et overblik, ikke en anbefaling — der rangordnes ingen kandidat. Rækkefølgen er puljens
 * (sort_order, navn), og tie-break ved lige gode kandidater er stadig ejerens punkt
 * (se matching/algorithm.ts). TODO(ejer): tie-break-regler.
 */

import { computeSwapDelta, type MatchCandidate, type SwapDelta } from "@/server/matching/algorithm";

export interface SwapOption {
  candidate: MatchCandidate;
  /** Ejerens ønskede tags der tilkommer / udgår hvis kandidaten træder ind. */
  delta: SwapDelta;
  /** Har boardet stadig en intern partner bagefter? Falsk = udskiftningen afvises af invarianten. */
  keepsInternal: boolean;
}

export function listSwapOptions(
  ownerTagIds: readonly string[],
  members: readonly MatchCandidate[],
  outgoingId: string,
  pool: readonly MatchCandidate[],
): SwapOption[] {
  const memberIds = new Set(members.map((member) => member.id));
  return pool
    .filter((candidate) => !memberIds.has(candidate.id))
    .map((candidate) => ({
      candidate,
      delta: computeSwapDelta(ownerTagIds, members, outgoingId, candidate),
      keepsInternal:
        candidate.isInternal || members.some((member) => member.id !== outgoingId && member.isInternal),
    }));
}
