/**
 * Drawing papers. The server chooses every question a learner sees, and
 * records the paper on the attempt before any answer arrives, so a
 * submission can only be graded against the questions actually asked.
 *
 * Randomness is injectable so tests can pin a draw.
 */
import { CHECK_LENGTH, TIERS, type Tier } from './placement.js';

export const PLACEMENT_PER_TIER = 2;

type Random = () => number;

function shuffled<T>(items: readonly T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Up to `perTier` questions from each tier, in tier order. */
export function drawPlacement<T extends { tier: Tier }>(
  bank: readonly T[],
  perTier = PLACEMENT_PER_TIER,
  random: Random = Math.random,
): T[] {
  return TIERS.flatMap((tier) => shuffled(bank.filter((q) => q.tier === tier), random).slice(0, perTier));
}

/** Exactly `length` questions, or null when the bank cannot fill a paper. */
export function drawCheck<T>(bank: readonly T[], length = CHECK_LENGTH, random: Random = Math.random): T[] | null {
  if (bank.length < length) return null;
  return shuffled(bank, random).slice(0, length);
}
