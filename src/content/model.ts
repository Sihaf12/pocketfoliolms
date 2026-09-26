/**
 * The three review units and their snapshots.
 *
 *   course         metadata and its placement questions
 *   lesson         body, video asset, transcript, and its check questions
 *   glossary_term  platform only
 *
 * A snapshot is what a reviewer approves and what a publish copies into
 * the live rows. Drafts may be saved half-finished; the checks here run
 * when a version is sent for review, and again when it is published.
 */
import { lessonProblems } from '../../packages/shared/markdown.js';
import { CHECK_LENGTH, TIERS, type Tier } from '../domain/placement.js';

export type EntityKind = 'course' | 'lesson' | 'glossary_term';

export interface QuestionSnapshot {
  id: string;
  prompt: string;
  options: { key: string; text: string }[];
  correctKey: string;
  rationales: Record<string, string>;
}

export interface PlacementQuestionSnapshot extends QuestionSnapshot {
  tier: Tier;
}

export interface CourseSnapshot {
  title: string;
  summary: string;
  tier: Tier;
  estMinutes: number;
  placementQuestions: PlacementQuestionSnapshot[];
}

export interface LessonSnapshot {
  courseId: string;
  position: number;
  title: string;
  bodyMd: string;
  videoAsset: string | null;
  transcript: { at: string; text: string }[];
  minutes: number;
  xp: number;
  requires: string[];
  questions: QuestionSnapshot[];
}

export interface GlossarySnapshot {
  term: string;
  definition: string;
  related: string[];
}

export type Snapshot = CourseSnapshot | LessonSnapshot | GlossarySnapshot;

/* ------------------------------------------------------------------ */
/* Request schemas. Shape only: meaning is checked at submission.      */
/* ------------------------------------------------------------------ */

const uuid = { type: 'string', format: 'uuid' } as const;
const key = { type: 'string', pattern: '^[a-e]$' } as const;

const question = {
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'options', 'correctKey', 'rationales'],
  properties: {
    // Absent for a new question: the server assigns it.
    id: uuid,
    prompt: { type: 'string', minLength: 1, maxLength: 500 },
    options: {
      type: 'array', minItems: 2, maxItems: 5,
      items: {
        type: 'object', additionalProperties: false, required: ['key', 'text'],
        properties: { key, text: { type: 'string', minLength: 1, maxLength: 300 } },
      },
    },
    correctKey: key,
    rationales: { type: 'object', propertyNames: key, additionalProperties: { type: 'string', maxLength: 600 } },
  },
} as const;

export const courseDraftSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'tier', 'estMinutes'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    summary: { type: 'string', maxLength: 300 },
    tier: { type: 'string', enum: TIERS },
    estMinutes: { type: 'integer', minimum: 1, maximum: 600 },
    placementQuestions: {
      type: 'array', maxItems: 20,
      items: { ...question, required: [...question.required, 'tier'], properties: { ...question.properties, tier: { type: 'string', enum: TIERS } } },
    },
  },
} as const;

export const lessonDraftSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['position', 'title', 'bodyMd', 'minutes'],
  properties: {
    position: { type: 'integer', minimum: 1, maximum: 200 },
    title: { type: 'string', minLength: 1, maxLength: 120 },
    bodyMd: { type: 'string', maxLength: 20_000 },
    // A reference to an asset in the media store, never a URL to anywhere.
    videoAsset: { type: ['string', 'null'], pattern: '^[A-Za-z0-9][A-Za-z0-9/_.-]{0,299}$' },
    transcript: {
      type: 'array', maxItems: 200,
      items: {
        type: 'object', additionalProperties: false, required: ['at', 'text'],
        properties: { at: { type: 'string', pattern: '^[0-9]{1,2}:[0-5][0-9]$' }, text: { type: 'string', minLength: 1, maxLength: 500 } },
      },
    },
    minutes: { type: 'integer', minimum: 1, maximum: 60 },
    xp: { type: 'integer', minimum: 0, maximum: 1000 },
    requires: { type: 'array', maxItems: 10, uniqueItems: true, items: uuid },
    questions: { type: 'array', maxItems: 30, items: question },
  },
} as const;

export const glossaryDraftSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['term', 'definition'],
  properties: {
    term: { type: 'string', minLength: 1, maxLength: 80 },
    definition: { type: 'string', minLength: 1, maxLength: 600 },
    related: { type: 'array', maxItems: 10, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 80 } },
  },
} as const;

/* ------------------------------------------------------------------ */
/* Submission checks.                                                  */
/* ------------------------------------------------------------------ */

function questionProblems(q: QuestionSnapshot, label: string): string[] {
  const problems: string[] = [];
  const keys = q.options.map((o) => o.key);
  if (new Set(keys).size !== keys.length) problems.push(`${label}: each option needs its own letter.`);
  if (!keys.includes(q.correctKey)) problems.push(`${label}: the correct answer is not one of its options.`);
  for (const k of keys) {
    if (!(q.rationales[k] ?? '').trim()) problems.push(`${label}: option ${k.toUpperCase()} needs a rationale.`);
  }
  for (const k of Object.keys(q.rationales)) {
    if (!keys.includes(k)) problems.push(`${label}: there is a rationale for option ${k.toUpperCase()}, which does not exist.`);
  }
  return problems;
}

/** Everything an author must fix before this version can be reviewed. Empty means ready. */
export function submissionProblems(kind: EntityKind, snapshot: Snapshot): string[] {
  if (kind === 'course') {
    const c = snapshot as CourseSnapshot;
    const problems: string[] = [];
    if (!c.title.trim()) problems.push('The course needs a title.');
    if (!c.summary.trim()) problems.push('Add a one-line summary learners see before they start.');
    c.placementQuestions.forEach((q, i) => problems.push(...questionProblems(q, `Placement question ${i + 1}`)));
    return problems;
  }
  if (kind === 'lesson') {
    const l = snapshot as LessonSnapshot;
    const problems = lessonProblems(l.bodyMd);
    if (l.questions.length < CHECK_LENGTH) {
      problems.push(`A lesson needs at least ${CHECK_LENGTH} check questions, so a knowledge check can be drawn. It has ${l.questions.length}.`);
    }
    l.questions.forEach((q, i) => problems.push(...questionProblems(q, `Question ${i + 1}`)));
    return problems;
  }
  const g = snapshot as GlossarySnapshot;
  return g.term.trim() && g.definition.trim() ? [] : ['A glossary term needs the term and its definition.'];
}

/** The title a version is known by in queues and timelines. */
export function titleOf(kind: EntityKind, snapshot: Snapshot): string {
  return kind === 'glossary_term' ? (snapshot as GlossarySnapshot).term : (snapshot as CourseSnapshot | LessonSnapshot).title;
}

/** Top-level fields that differ between two snapshots, for the reviewer's diff. */
export function changedFields(before: Snapshot | null, after: Snapshot): string[] {
  if (!before) return Object.keys(after);
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
