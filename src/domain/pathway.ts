/**
 * Lesson availability: the one rule behind every lock the learner sees.
 * The pathway shows it and the lesson routes enforce it, both from here,
 * so what a learner is shown and what they are allowed cannot disagree.
 *
 *   done     the lesson has a passed knowledge check
 *   locked   its tier is shut, or a lesson it requires is not yet done
 *   open     otherwise
 */
import { gateReason, tierUnlocked, type Tier, type TierScores } from './placement.js';

export type LessonState = 'done' | 'open' | 'locked';

export interface Availability {
  state: LessonState;
  gateReason: string | null;
  /** What keeps a locked lesson shut. The tier is checked first. */
  blockedBy: 'tier' | 'prerequisites' | null;
}

/** "Requires: A", "Requires: A and B", "Requires: A, B and C". */
export function requiresText(titles: readonly string[]): string {
  if (titles.length === 0) return 'Requires: an earlier lesson';
  if (titles.length === 1) return `Requires: ${titles[0]}`;
  return `Requires: ${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
}

export function availability(
  tier: Tier,
  baseline: TierScores,
  passed: boolean,
  unmetPrerequisites: readonly string[],
): Availability {
  if (passed) return { state: 'done', gateReason: null, blockedBy: null };
  if (!tierUnlocked(tier, baseline)) {
    return { state: 'locked', gateReason: gateReason(tier, baseline), blockedBy: 'tier' };
  }
  if (unmetPrerequisites.length > 0) {
    return { state: 'locked', gateReason: requiresText(unmetPrerequisites), blockedBy: 'prerequisites' };
  }
  return { state: 'open', gateReason: null, blockedBy: null };
}
