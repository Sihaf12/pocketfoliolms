/**
 * Placement and gating. The rules from the journey model, in one place,
 * so the API, the worker and any future admin tool cannot drift apart.
 */
export type Tier = 'learn' | 'safeguard' | 'apply' | 'specialise';
export type Level = 'explorer' | 'learner' | 'practitioner' | 'specialist';

export const TIERS: readonly Tier[] = ['learn', 'safeguard', 'apply', 'specialise'] as const;

/** Weighting fixed by the product: the check counts for more than the self-rating. */
export const TEST_WEIGHT = 0.6;
export const SELF_WEIGHT = 0.4;

export interface PlacementAnswer {
  tier: Tier;
  /** null means skipped. A skip scores zero and becomes a lesson in the path. */
  correct: boolean | null;
}

export type TierScores = Record<Tier, number>;

export function baselineFrom(answers: PlacementAnswer[], selfRating: TierScores): TierScores {
  const out = {} as TierScores;
  for (const tier of TIERS) {
    const forTier = answers.filter((a) => a.tier === tier);
    const asked = forTier.length;
    const correct = forTier.filter((a) => a.correct === true).length;
    const testPct = asked === 0 ? 0 : (correct / asked) * 100;
    const self = clamp(selfRating[tier] ?? 0, 0, 100);
    out[tier] = Math.round(testPct * TEST_WEIGHT + self * SELF_WEIGHT);
  }
  return out;
}

export function levelFrom(baseline: TierScores): Level {
  const avg = TIERS.reduce((s, t) => s + baseline[t], 0) / TIERS.length;
  if (avg < 35) return 'explorer';
  if (avg < 55) return 'learner';
  if (avg < 75) return 'practitioner';
  return 'specialist';
}

/** Published thresholds. Identical for every learner, shown in the UI. */
export function tierUnlocked(tier: Tier, b: TierScores): boolean {
  switch (tier) {
    case 'learn':
    case 'safeguard':
      return true;
    case 'apply':
      return b.learn >= 50;
    case 'specialise':
      return b.learn >= 70 && b.safeguard >= 50;
  }
}

/** What opens a tier, said without anyone's scores: for pages anyone can read. */
export function tierRequirement(tier: Tier): string | null {
  if (tier === 'apply') return 'Unlocks at Learn 50';
  if (tier === 'specialise') return 'Unlocks at Learn 70 and Safeguard 50';
  return null;
}

export function gateReason(tier: Tier, b: TierScores): string | null {
  if (tierUnlocked(tier, b)) return null;
  if (tier === 'apply') return `Unlocks at Learn 50 or above. You are at ${b.learn}.`;
  return `Unlocks at Learn 70 and Safeguard 50. You are at ${b.learn} and ${b.safeguard}.`;
}

/** A knowledge check passes at two of three. This is the North Star atom. */
export const PASS_THRESHOLD = 2;
export const CHECK_LENGTH = 3;

export function gradeCheck(correct: number): { passed: boolean; stars: 0 | 1 | 2 | 3 } {
  const passed = correct >= PASS_THRESHOLD;
  const stars = correct >= 3 ? 3 : correct === 2 ? 2 : correct === 1 ? 1 : 0;
  return { passed, stars };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
