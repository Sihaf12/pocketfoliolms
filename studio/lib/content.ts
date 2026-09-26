/** The content API's shapes, as the studio uses them. */
import type { Action, ReviewState, Tier } from './format';

export type EntityKind = 'course' | 'lesson' | 'glossary_term';

export interface Question {
  id?: string;
  prompt: string;
  options: { key: string; text: string }[];
  correctKey: string;
  rationales: Record<string, string>;
}
export interface PlacementQuestion extends Question { tier: Tier }

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
  questions: Question[];
}

export interface CourseSnapshot {
  title: string;
  summary: string;
  tier: Tier;
  estMinutes: number;
  placementQuestions: PlacementQuestion[];
}

export interface GlossarySnapshot { term: string; definition: string; related: string[] }

export interface Version<S = LessonSnapshot | CourseSnapshot | GlossarySnapshot> {
  id: string;
  entityType: EntityKind;
  entityId: string;
  number: number;
  state: ReviewState;
  snapshot: S;
  createdBy: string | null;
  submittedBy: string | null;
  reviewedBy: string | null;
  publishedBy: string | null;
  rejectedBy: string | null;
  rejectionNotes: string | null;
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  rejectedAt: string | null;
}

export interface VersionView<S = LessonSnapshot | CourseSnapshot | GlossarySnapshot> {
  version: Version<S>;
  people: Record<string, string>;
  changedFields: string[];
  isNew: boolean;
  actions: Action[];
  readOnly: boolean;
}

export interface CourseDetail {
  course: {
    id: string; title: string; tier: Tier; summary: string; estMinutes: number; liveState: ReviewState; readOnly: boolean;
    /** In an academy: whether its catalogue offers the course. Null on the console. */
    offered: boolean | null;
  };
  lessons: { id: string; title: string; position: number; live: boolean; versionId: string | null; versionState: ReviewState | null }[];
}

export const MIN_CHECK_QUESTIONS = 5;
export const CHECK_LENGTH = 3;
export const KEYS = ['a', 'b', 'c', 'd', 'e'] as const;

export const blankQuestion = (): Question => ({
  prompt: '',
  options: [{ key: 'a', text: '' }, { key: 'b', text: '' }, { key: 'c', text: '' }],
  correctKey: 'a',
  rationales: { a: '', b: '', c: '' },
});

/** What the draft routes accept for a lesson: the snapshot without its course. */
export function lessonDraftBody(s: LessonSnapshot) {
  const { courseId: _course, ...body } = s;
  return body;
}
