/**
 * The content review workflow. One place for the rules, so the API, the
 * studio and the console cannot drift apart.
 *
 *   draft ─submit─▶ in_expert_review ─approve─▶ in_compliance_review ─publish─▶ published ─retire─▶ retired
 *                        │ reject (notes)              │ reject (notes)
 *                        ▼                             ▼
 *                     rejected ◀───────────────────────┘
 *
 * A rejected version stays rejected. Revising it, or editing published
 * content, opens a new draft version from its snapshot. A newer publish
 * retires the version it replaces.
 *
 * The database enforces the same machine (platform.content_version_guard),
 * so a bug here cannot skip a step; this module decides what to offer
 * and explains a refusal before the database has to.
 *
 * Separation: the author and the publisher are always different people.
 * An academy may also require the reviewer to be a third person; platform
 * content always does.
 */

export type ReviewState =
  | 'draft' | 'in_expert_review' | 'in_compliance_review' | 'approved' | 'published' | 'rejected' | 'retired';

export type ReviewAction = 'submit' | 'approve' | 'reject' | 'publish' | 'retire' | 'revise';

/** What a person may do in the workflow. Academy roles and platform staff roles map onto these. */
export type Duty = 'author' | 'reviewer' | 'compliance';

export type StudioRole = 'author' | 'reviewer' | 'compliance' | 'tenant_admin';
export type StaffRole = 'platform_owner' | 'platform_author' | 'platform_reviewer' | 'platform_compliance';

export const DUTY_OF: Record<StudioRole | StaffRole, Duty | null> = {
  author: 'author',
  reviewer: 'reviewer',
  compliance: 'compliance',
  tenant_admin: null,
  platform_author: 'author',
  platform_reviewer: 'reviewer',
  platform_compliance: 'compliance',
  platform_owner: null,
};

interface Step {
  from: ReviewState;
  to: ReviewState;
  duty: Duty;
  notes: boolean;
}

/** Each action, from each state it is legal in. revise opens a new draft; the source is unchanged. */
const STEPS: Record<ReviewAction, Step[]> = {
  submit: [{ from: 'draft', to: 'in_expert_review', duty: 'author', notes: false }],
  approve: [{ from: 'in_expert_review', to: 'in_compliance_review', duty: 'reviewer', notes: false }],
  reject: [
    { from: 'in_expert_review', to: 'rejected', duty: 'reviewer', notes: true },
    { from: 'in_compliance_review', to: 'rejected', duty: 'compliance', notes: true },
  ],
  publish: [{ from: 'in_compliance_review', to: 'published', duty: 'compliance', notes: false }],
  retire: [{ from: 'published', to: 'retired', duty: 'compliance', notes: false }],
  revise: [
    { from: 'rejected', to: 'draft', duty: 'author', notes: false },
    { from: 'published', to: 'draft', duty: 'author', notes: false },
  ],
};

export type Refusal =
  | { code: 'illegal_transition'; message: string }
  | { code: 'wrong_role'; message: string }
  | { code: 'notes_required'; message: string }
  | { code: 'separation'; message: string };

export type Outcome = { ok: true; to: ReviewState } | { ok: false; refusal: Refusal };

export interface Signoffs {
  /** The person who sent the version for review. */
  author: string | null;
  reviewer: string | null;
  publisher: string | null;
}

export const SIGNOFF_FLOOR = 2;
export const SIGNOFF_CEILING = 3;
export const PLATFORM_SIGNOFFS = 3;

/** How many different people a version needs. Platform content is fixed at three. */
export function requiredSignoffs(scope: 'platform' | 'academy', academySetting: number | null): number {
  if (scope === 'platform') return PLATFORM_SIGNOFFS;
  const setting = academySetting ?? SIGNOFF_FLOOR;
  if (!Number.isInteger(setting) || setting < SIGNOFF_FLOOR || setting > SIGNOFF_CEILING) {
    throw new RangeError(`review sign-offs must be ${SIGNOFF_FLOOR} or ${SIGNOFF_CEILING}, not ${setting}`);
  }
  return setting;
}

/** Whether publishing by `publisher` would respect the separation rule. */
export function separationRefusal(s: Signoffs, required: number): Refusal | null {
  if (s.publisher !== null && s.publisher === s.author) {
    return { code: 'separation', message: 'You wrote this version, so someone else has to publish it.' };
  }
  if (required >= 3 && s.reviewer !== null && (s.reviewer === s.author || s.reviewer === s.publisher)) {
    return {
      code: 'separation',
      message: 'This content needs three different people: the author, the reviewer and the publisher.',
    };
  }
  return null;
}

export interface Attempt {
  action: ReviewAction;
  state: ReviewState;
  actorDuty: Duty | null;
  actorId: string;
  notes?: string | null;
  signoffs: Signoffs;
  required: number;
}

/** Decides one action. Mirrors the database trigger, and adds the role check it cannot make. */
export function decide(a: Attempt): Outcome {
  const step = STEPS[a.action].find((s) => s.from === a.state);
  if (!step) {
    return { ok: false, refusal: { code: 'illegal_transition', message: `A version that is ${label(a.state)} cannot be ${PAST[a.action]}.` } };
  }
  if (a.actorDuty !== step.duty) {
    return { ok: false, refusal: { code: 'wrong_role', message: `Only ${DUTY_LABEL[step.duty]} can do that.` } };
  }
  if (step.notes && !(a.notes ?? '').trim()) {
    return { ok: false, refusal: { code: 'notes_required', message: 'Say what needs to change before sending it back.' } };
  }
  if (a.action === 'approve' && a.required >= 3 && a.actorId === a.signoffs.author) {
    return { ok: false, refusal: { code: 'separation', message: 'You wrote this version, so someone else has to review it.' } };
  }
  if (a.action === 'publish') {
    const refusal = separationRefusal({ ...a.signoffs, publisher: a.actorId }, a.required);
    if (refusal) return { ok: false, refusal };
  }
  return { ok: true, to: step.to };
}

/** The actions a person could take on a version now, for the studio to offer. */
export function availableActions(state: ReviewState, duty: Duty | null): ReviewAction[] {
  return (Object.keys(STEPS) as ReviewAction[]).filter((action) =>
    STEPS[action].some((s) => s.from === state && s.duty === duty));
}

const PAST: Record<ReviewAction, string> = {
  submit: 'sent for review', approve: 'approved', reject: 'sent back', publish: 'published',
  retire: 'retired', revise: 'revised',
};

const DUTY_LABEL: Record<Duty, string> = {
  author: 'an author', reviewer: 'a reviewer', compliance: 'compliance',
};

function label(state: ReviewState): string {
  return {
    draft: 'a draft', in_expert_review: 'in review', in_compliance_review: 'with compliance', approved: 'approved',
    published: 'published', rejected: 'sent back', retired: 'retired',
  }[state];
}
