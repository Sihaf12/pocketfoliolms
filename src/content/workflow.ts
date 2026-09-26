/**
 * The content workflow, written once for both owners of content:
 *
 *   an academy   its private courses, edited in its studio, as app_studio
 *   the platform platform courses and the glossary, edited in the console
 *
 * Drafts are snapshots in platform.content_versions. Learners read the
 * live rows (platform.courses, lessons, questions, glossary_terms), and
 * only a publish writes them: in the same transaction as the version's
 * change of state, the retirement of the version it replaces, and the
 * audit record. The review rules come from domain/review.ts; the
 * database trigger enforces the same machine underneath.
 */
import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type { AuditEntry } from '../db/unitOfWork.js';
import {
  availableActions, decide, requiredSignoffs, type Duty, type ReviewAction, type ReviewState,
} from '../domain/review.js';
import { HttpError } from '../http/errors.js';
import {
  changedFields, submissionProblems, titleOf,
  type CourseSnapshot, type EntityKind, type GlossarySnapshot, type LessonSnapshot,
  type PlacementQuestionSnapshot, type QuestionSnapshot, type Snapshot,
} from './model.js';

/** What both units of work offer: the studio's ScopedDb and the console's ConsoleDb. */
export interface ContentDb {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<T>;
  maybeOne<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<T | null>;
  audit(entry: AuditEntry): Promise<void>;
}

export interface Scope {
  /** The owning academy, or null for platform content. */
  owner: string | null;
  /** Where the people who act are named. */
  people: 'users' | 'staff';
}

export interface Actor {
  id: string;
  duties: readonly Duty[];
}

export interface Version {
  id: string;
  entityType: EntityKind;
  entityId: string;
  number: number;
  state: ReviewState;
  snapshot: Snapshot;
  owner: string | null;
  createdBy: string | null;
  submittedBy: string | null;
  reviewedBy: string | null;
  publishedBy: string | null;
  rejectedBy: string | null;
  rejectionNotes: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  publishedAt: Date | null;
  rejectedAt: Date | null;
  retiredAt: Date | null;
}

const VERSION = `
  id::text, entity_type AS "entityType", entity_id AS "entityId", version AS number, review_state AS state,
  snapshot, owner_tenant_id AS owner, created_by AS "createdBy", submitted_by AS "submittedBy",
  reviewed_by AS "reviewedBy", published_by AS "publishedBy", rejected_by AS "rejectedBy",
  rejection_notes AS "rejectionNotes", created_at AS "createdAt", submitted_at AS "submittedAt",
  reviewed_at AS "reviewedAt", published_at AS "publishedAt", rejected_at AS "rejectedAt", retired_at AS "retiredAt"`;

/** Rows this scope owns. Platform content is read-only to an academy, and only once published. */
const OWNED = `owner_tenant_id IS NOT DISTINCT FROM $OWNER`;
const bind = (sql: string, ownerParam: number) => sql.replace(/\$OWNER/g, `$${ownerParam}::uuid`);

function requireDuty(actor: Actor, duty: Duty): void {
  if (!actor.duties.includes(duty)) {
    const who = { author: 'an author', reviewer: 'a reviewer', compliance: 'compliance' }[duty];
    throw new HttpError(403, 'wrong_role', `Only ${who} can do that.`);
  }
}

async function requiredFor(db: ContentDb, scope: Scope): Promise<number> {
  if (scope.owner === null) return requiredSignoffs('platform', null);
  const s = await db.maybeOne<{ n: number }>('SELECT review_signoffs AS n FROM app.tenant_settings WHERE tenant_id = $1', [scope.owner]);
  return requiredSignoffs('academy', s?.n ?? null);
}

async function namesOf(db: ContentDb, scope: Scope, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => x !== null))];
  if (!wanted.length) return new Map();
  const table = scope.people === 'users' ? 'app.users' : 'platform.staff';
  const rows = await db.query<{ id: string; name: string }>(
    `SELECT id, display_name AS name FROM ${table} WHERE id = ANY($1::uuid[])`, [wanted]);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/* ------------------------------------------------------------------ */
/* Question ids                                                        */
/* ------------------------------------------------------------------ */

/**
 * The ids a draft may use: any this entity has had before. A new question
 * arrives without an id and gets one here, so a draft cannot claim a
 * question that belongs to another lesson and overwrite it on publish.
 */
async function knownQuestionIds(db: ContentDb, kind: EntityKind, entityId: string): Promise<Set<string>> {
  const field = kind === 'course' ? 'placementQuestions' : 'questions';
  const fromVersions = await db.query<{ id: string }>(
    `SELECT DISTINCT q->>'id' AS id
       FROM platform.content_versions v, jsonb_array_elements(COALESCE(v.snapshot->$3, '[]'::jsonb)) q
      WHERE v.entity_type = $1 AND v.entity_id = $2`,
    [kind, entityId, field],
  );
  const live = await db.query<{ id: string }>(
    kind === 'course'
      ? 'SELECT id FROM platform.questions WHERE course_id = $1 AND is_placement AND lesson_id IS NULL'
      : 'SELECT id FROM platform.questions WHERE lesson_id = $1',
    [entityId],
  );
  return new Set([...fromVersions, ...live].map((r) => r.id));
}

function withIds<T extends Omit<QuestionSnapshot, 'id'> & { id?: string }>(questions: T[], known: Set<string>): (T & { id: string })[] {
  return questions.map((q) => {
    if (q.id === undefined) return { ...q, id: randomUUID() };
    if (!known.has(q.id)) {
      throw new HttpError(422, 'unknown_question_id', 'A question has an id this content has never had. Leave the id out for a new question.');
    }
    return { ...q, id: q.id };
  });
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

async function versionById(db: ContentDb, scope: Scope, id: string, lock: boolean): Promise<Version | null> {
  if (!/^\d{1,18}$/.test(id)) return null;
  return db.maybeOne<Version>(
    bind(`SELECT ${VERSION} FROM platform.content_versions WHERE id = $1::bigint AND ${OWNED}${lock ? ' FOR UPDATE' : ''}`, 2),
    [id, scope.owner],
  );
}

async function publishedSnapshot(db: ContentDb, kind: EntityKind, entityId: string): Promise<Snapshot | null> {
  const row = await db.maybeOne<{ snapshot: Snapshot }>(
    `SELECT snapshot FROM platform.content_versions
      WHERE entity_type = $1 AND entity_id = $2 AND review_state = 'published' ORDER BY version DESC LIMIT 1`,
    [kind, entityId],
  );
  return row?.snapshot ?? null;
}

export interface VersionView {
  version: Version;
  people: Record<string, string>;
  changedFields: string[];
  actions: ReviewAction[];
  readOnly: boolean;
}

/**
 * One version, with what changed against the live content and what this
 * person could do with it now. An academy may also read a published
 * platform version, read-only.
 */
export async function viewVersion(db: ContentDb, scope: Scope, actor: Actor, id: string): Promise<VersionView> {
  let version = await versionById(db, scope, id, false);
  let readOnly = false;
  if (!version && scope.owner !== null && /^\d{1,18}$/.test(id)) {
    version = await db.maybeOne<Version>(
      `SELECT ${VERSION} FROM platform.content_versions
        WHERE id = $1::bigint AND owner_tenant_id IS NULL AND review_state IN ('published', 'retired')`, [id]);
    readOnly = version !== null;
  }
  if (!version) throw new HttpError(404, 'not_found', 'No such version.');

  const live = await publishedSnapshot(db, version.entityType, version.entityId);
  const required = readOnly ? 3 : await requiredFor(db, scope);
  const actions = readOnly ? [] : availableActions(version.state, actor.duties).filter((action) =>
    decide({
      action, state: version!.state, actorDuties: actor.duties, actorId: actor.id, notes: 'x', required,
      signoffs: { author: version!.submittedBy, reviewer: version!.reviewedBy, publisher: null },
    }).ok);
  const names = readOnly ? new Map<string, string>() : await namesOf(db, scope,
    [version.createdBy, version.submittedBy, version.reviewedBy, version.publishedBy, version.rejectedBy]);
  return {
    version,
    people: Object.fromEntries(names),
    changedFields: version.state === 'published' ? [] : changedFields(live, version.snapshot),
    actions,
    readOnly,
  };
}

export async function versionHistory(db: ContentDb, scope: Scope, kind: EntityKind, entityId: string): Promise<Version[]> {
  return db.query<Version>(
    bind(`SELECT ${VERSION} FROM platform.content_versions
           WHERE entity_type = $1 AND entity_id = $2
             AND (${OWNED} OR (owner_tenant_id IS NULL AND review_state IN ('published', 'retired')))
           ORDER BY version DESC`, 3),
    [kind, entityId, scope.owner],
  );
}

export interface QueueItem {
  versionId: string;
  entityType: EntityKind;
  entityId: string;
  number: number;
  state: ReviewState;
  title: string;
  submittedBy: string | null;
  submittedAt: Date | null;
}

/** What is waiting for this person: expert review for reviewers, compliance review for compliance. */
export async function reviewQueue(db: ContentDb, scope: Scope, actor: Actor): Promise<QueueItem[]> {
  const states = [
    ...(actor.duties.includes('reviewer') ? ['in_expert_review'] : []),
    ...(actor.duties.includes('compliance') ? ['in_compliance_review'] : []),
  ];
  if (!states.length) return [];
  const rows = await db.query<Version>(
    bind(`SELECT ${VERSION} FROM platform.content_versions
           WHERE ${OWNED} AND review_state::text = ANY($1::text[]) ORDER BY submitted_at`, 2),
    [states, scope.owner],
  );
  const names = await namesOf(db, scope, rows.map((r) => r.submittedBy));
  return rows.map((v) => ({
    versionId: v.id, entityType: v.entityType, entityId: v.entityId, number: v.number, state: v.state,
    title: titleOf(v.entityType, v.snapshot),
    submittedBy: v.submittedBy ? names.get(v.submittedBy) ?? null : null, submittedAt: v.submittedAt,
  }));
}

/* ------------------------------------------------------------------ */
/* Creating and drafting                                               */
/* ------------------------------------------------------------------ */

async function insertDraft(db: ContentDb, scope: Scope, actor: Actor, kind: EntityKind, entityId: string, snapshot: Snapshot): Promise<Version> {
  const next = await db.one<{ n: number }>(
    'SELECT COALESCE(MAX(version), 0) + 1 AS n FROM platform.content_versions WHERE entity_type = $1 AND entity_id = $2',
    [kind, entityId],
  );
  try {
    return await db.one<Version>(
      `INSERT INTO platform.content_versions (entity_type, entity_id, version, review_state, snapshot, owner_tenant_id, created_by)
       VALUES ($1, $2, $3, 'draft', $4::jsonb, $5, $6) RETURNING ${VERSION}`,
      [kind, entityId, next.n, JSON.stringify(snapshot), scope.owner, actor.id],
    );
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new HttpError(409, 'version_in_flight', 'A version of this is already being drafted or reviewed.');
    }
    throw err;
  }
}

export type CourseDraft = Omit<CourseSnapshot, 'placementQuestions'> & { placementQuestions?: (Omit<PlacementQuestionSnapshot, 'id'> & { id?: string })[] };
export type LessonDraft = Omit<LessonSnapshot, 'courseId' | 'questions' | 'videoAsset' | 'transcript' | 'xp' | 'requires'> & {
  videoAsset?: string | null; transcript?: LessonSnapshot['transcript']; xp?: number; requires?: string[];
  questions?: (Omit<QuestionSnapshot, 'id'> & { id?: string })[];
};

const slugify = (title: string) =>
  title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'course';

export async function createCourse(db: ContentDb, scope: Scope, actor: Actor, body: CourseDraft): Promise<Version> {
  requireDuty(actor, 'author');
  const id = randomUUID();
  // The live row exists from the start so lessons can belong to it; learners
  // see a course only once it is published.
  await db.query(
    `INSERT INTO platform.courses (id, slug, title, tier, summary, est_minutes, review_state, owner_tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)`,
    [id, `${slugify(body.title)}-${id.slice(0, 8)}`, body.title, body.tier, body.summary, body.estMinutes, scope.owner],
  );
  const snapshot: CourseSnapshot = { ...body, placementQuestions: withIds(body.placementQuestions ?? [], new Set()) };
  const version = await insertDraft(db, scope, actor, 'course', id, snapshot);
  await db.audit({ action: 'content.created', entityType: 'course', entityId: id, payload: { version: version.number } });
  return version;
}

async function ownedCourse(db: ContentDb, scope: Scope, courseId: string): Promise<{ id: string; tier: string }> {
  const course = await db.maybeOne<{ id: string; tier: string; owner: string | null }>(
    'SELECT id, tier, owner_tenant_id AS owner FROM platform.courses WHERE id = $1', [courseId]);
  if (!course) throw new HttpError(404, 'not_found', 'No such course.');
  if (course.owner !== scope.owner) {
    throw new HttpError(403, 'read_only', 'This course belongs to the platform. It can be switched on or off, not edited here.');
  }
  return course;
}

export async function createLesson(db: ContentDb, scope: Scope, actor: Actor, courseId: string, body: LessonDraft): Promise<Version> {
  requireDuty(actor, 'author');
  await ownedCourse(db, scope, courseId);
  const id = randomUUID();
  const snapshot: LessonSnapshot = {
    courseId, position: body.position, title: body.title, bodyMd: body.bodyMd, videoAsset: body.videoAsset ?? null,
    transcript: body.transcript ?? [], minutes: body.minutes, xp: body.xp ?? 0, requires: body.requires ?? [],
    questions: withIds(body.questions ?? [], new Set()),
  };
  const version = await insertDraft(db, scope, actor, 'lesson', id, snapshot);
  await db.audit({ action: 'content.created', entityType: 'lesson', entityId: id, payload: { version: version.number, course_id: courseId } });
  return version;
}

export async function createGlossaryTerm(db: ContentDb, scope: Scope, actor: Actor, body: GlossarySnapshot): Promise<Version> {
  requireDuty(actor, 'author');
  if (scope.owner !== null) throw new HttpError(403, 'read_only', 'The glossary belongs to the platform.');
  const id = randomUUID();
  const version = await insertDraft(db, scope, actor, 'glossary_term', id, { term: body.term, definition: body.definition, related: body.related ?? [] });
  await db.audit({ action: 'content.created', entityType: 'glossary_term', entityId: id, payload: { version: version.number } });
  return version;
}

/** Replaces the open draft's snapshot. Only a draft can change; review freezes it. */
export async function saveDraft(db: ContentDb, scope: Scope, actor: Actor, kind: EntityKind, entityId: string, body: unknown): Promise<Version> {
  requireDuty(actor, 'author');
  const open = await db.maybeOne<Version>(
    bind(`SELECT ${VERSION} FROM platform.content_versions
           WHERE entity_type = $1 AND entity_id = $2 AND ${OWNED}
             AND review_state IN ('draft', 'in_expert_review', 'in_compliance_review') FOR UPDATE`, 3),
    [kind, entityId, scope.owner],
  );
  if (!open) {
    const any = await db.maybeOne(bind(`SELECT 1 FROM platform.content_versions WHERE entity_type = $1 AND entity_id = $2 AND ${OWNED} LIMIT 1`, 3),
      [kind, entityId, scope.owner]);
    if (!any) throw new HttpError(404, 'not_found', 'Nothing to edit with that id here.');
    throw new HttpError(409, 'no_draft', 'Nothing is being drafted. Revise the latest version to start a new draft.');
  }
  if (open.state !== 'draft') throw new HttpError(409, 'in_review', 'This version is in review and cannot change. Wait for it to come back, or be published.');

  const known = await knownQuestionIds(db, kind, entityId);
  let snapshot: Snapshot;
  if (kind === 'course') {
    const b = body as CourseDraft;
    snapshot = { ...b, placementQuestions: withIds(b.placementQuestions ?? [], known) };
  } else if (kind === 'lesson') {
    const b = body as LessonDraft;
    snapshot = {
      courseId: (open.snapshot as LessonSnapshot).courseId, position: b.position, title: b.title, bodyMd: b.bodyMd,
      videoAsset: b.videoAsset ?? null, transcript: b.transcript ?? [], minutes: b.minutes, xp: b.xp ?? 0,
      requires: b.requires ?? [], questions: withIds(b.questions ?? [], known),
    };
  } else {
    const b = body as GlossarySnapshot;
    snapshot = { term: b.term, definition: b.definition, related: b.related ?? [] };
  }
  return db.one<Version>(
    `UPDATE platform.content_versions SET snapshot = $2::jsonb WHERE id = $1::bigint RETURNING ${VERSION}`,
    [open.id, JSON.stringify(snapshot)],
  );
}

/* ------------------------------------------------------------------ */
/* Checks that need the database                                       */
/* ------------------------------------------------------------------ */

async function lessonContextProblems(db: ContentDb, lessonId: string, l: LessonSnapshot): Promise<string[]> {
  const problems: string[] = [];
  if (l.requires.includes(lessonId)) problems.push('A lesson cannot require itself.');
  const others = l.requires.filter((r) => r !== lessonId);
  const found = await db.query<{ id: string }>('SELECT id FROM platform.lessons WHERE id = ANY($1::uuid[])', [others]);
  if (found.length !== others.length) problems.push('Every lesson this one requires must already be published.');
  // Walk up from what this lesson requires. Reaching this lesson again
  // means a cycle: learners could never open either.
  const cycle = await db.maybeOne(
    `WITH RECURSIVE up(id) AS (
       SELECT unnest($1::uuid[])
       UNION
       SELECT p.requires_lesson_id FROM platform.lesson_prerequisites p JOIN up ON p.lesson_id = up.id
        WHERE p.lesson_id <> $2
     ) SELECT 1 FROM up WHERE id = $2 LIMIT 1`,
    [l.requires, lessonId],
  );
  if (cycle) problems.push('These requirements would make a loop: a lesson this one requires already requires it.');
  const clash = await db.maybeOne<{ title: string }>(
    'SELECT title FROM platform.lessons WHERE course_id = $1 AND position = $2 AND id <> $3', [l.courseId, l.position, lessonId]);
  if (clash) problems.push(`Position ${l.position} in this course is already "${clash.title}".`);
  return problems;
}

async function problemsFor(db: ContentDb, v: Version): Promise<string[]> {
  const problems = submissionProblems(v.entityType, v.snapshot);
  if (v.entityType === 'lesson') problems.push(...await lessonContextProblems(db, v.entityId, v.snapshot as LessonSnapshot));
  return problems;
}

/* ------------------------------------------------------------------ */
/* Publishing into the live rows                                       */
/* ------------------------------------------------------------------ */

async function upsertQuestions(db: ContentDb, courseId: string, lessonId: string | null, tierOf: (q: QuestionSnapshot) => string, questions: QuestionSnapshot[]): Promise<void> {
  for (const q of questions) {
    await db.query(
      `INSERT INTO platform.questions (id, course_id, lesson_id, tier, is_placement, prompt, options, correct_key, rationales)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb)
       ON CONFLICT (id) DO UPDATE SET course_id = EXCLUDED.course_id, lesson_id = EXCLUDED.lesson_id, tier = EXCLUDED.tier,
         is_placement = EXCLUDED.is_placement, prompt = EXCLUDED.prompt, options = EXCLUDED.options,
         correct_key = EXCLUDED.correct_key, rationales = EXCLUDED.rationales`,
      [q.id, courseId, lessonId, tierOf(q), lessonId === null, q.prompt, JSON.stringify(q.options), q.correctKey, JSON.stringify(q.rationales)],
    );
  }
  // Questions dropped from this version leave the live bank. Past attempts
  // keep their stored grade; only rebuilt feedback loses the question.
  const ids = questions.map((q) => q.id);
  if (lessonId === null) {
    await db.query('DELETE FROM platform.questions WHERE course_id = $1 AND is_placement AND lesson_id IS NULL AND NOT (id = ANY($2::uuid[]))', [courseId, ids]);
  } else {
    await db.query('DELETE FROM platform.questions WHERE lesson_id = $1 AND NOT (id = ANY($2::uuid[]))', [lessonId, ids]);
  }
}

async function applyLive(db: ContentDb, scope: Scope, v: Version): Promise<void> {
  if (v.entityType === 'course') {
    const c = v.snapshot as CourseSnapshot;
    await db.query(
      `UPDATE platform.courses
          SET title = $2, summary = $3, tier = $4, est_minutes = $5, review_state = 'published',
              published_at = COALESCE(published_at, now()), updated_at = now()
        WHERE id = $1`,
      [v.entityId, c.title, c.summary, c.tier, c.estMinutes],
    );
    await upsertQuestions(db, v.entityId, null, (q) => (q as PlacementQuestionSnapshot).tier, c.placementQuestions);
    return;
  }
  if (v.entityType === 'lesson') {
    const l = v.snapshot as LessonSnapshot;
    const course = await ownedCourse(db, scope, l.courseId);
    const names = await namesOf(db, scope, [v.submittedBy, v.reviewedBy]);
    await db.query(
      `INSERT INTO platform.lessons (id, course_id, position, title, body_md, video_asset, transcript, duration_secs,
                                     author_name, reviewer_name, reviewed_at, xp)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET position = EXCLUDED.position, title = EXCLUDED.title, body_md = EXCLUDED.body_md,
         video_asset = EXCLUDED.video_asset, transcript = EXCLUDED.transcript, duration_secs = EXCLUDED.duration_secs,
         author_name = EXCLUDED.author_name, reviewer_name = EXCLUDED.reviewer_name, reviewed_at = EXCLUDED.reviewed_at,
         xp = EXCLUDED.xp`,
      [v.entityId, l.courseId, l.position, l.title, l.bodyMd, l.videoAsset, JSON.stringify(l.transcript), l.minutes * 60,
        names.get(v.submittedBy ?? '') ?? '', names.get(v.reviewedBy ?? '') ?? '', v.reviewedAt, l.xp],
    );
    await upsertQuestions(db, l.courseId, v.entityId, () => course.tier, l.questions);
    await db.query('DELETE FROM platform.lesson_prerequisites WHERE lesson_id = $1', [v.entityId]);
    for (const requires of l.requires) {
      await db.query('INSERT INTO platform.lesson_prerequisites (lesson_id, requires_lesson_id) VALUES ($1, $2)', [v.entityId, requires]);
    }
    return;
  }
  const g = v.snapshot as GlossarySnapshot;
  try {
    await db.query(
      `INSERT INTO platform.glossary_terms (id, term, definition, related) VALUES ($1, $2, $3, $4::text[])
       ON CONFLICT (id) DO UPDATE SET term = EXCLUDED.term, definition = EXCLUDED.definition, related = EXCLUDED.related`,
      [v.entityId, g.term, g.definition, g.related],
    );
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'term_taken', `"${g.term}" is already in the glossary.`);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Transitions                                                         */
/* ------------------------------------------------------------------ */

const REFUSAL_STATUS: Record<string, number> = { illegal_transition: 409, wrong_role: 403, notes_required: 400, separation: 409 };

/**
 * One step of the workflow on one version. Returns the version as it now
 * stands, or, for revise, the new draft.
 */
export async function transition(
  db: ContentDb, scope: Scope, actor: Actor, versionId: string, action: ReviewAction, notes: string | null,
): Promise<Version> {
  const v = await versionById(db, scope, versionId, true);
  if (!v) throw new HttpError(404, 'not_found', 'No such version.');

  const outcome = decide({
    action, state: v.state, actorDuties: actor.duties, actorId: actor.id, notes, required: await requiredFor(db, scope),
    signoffs: { author: v.submittedBy, reviewer: v.reviewedBy, publisher: null },
  });
  if (!outcome.ok) throw new HttpError(REFUSAL_STATUS[outcome.refusal.code] ?? 409, outcome.refusal.code, outcome.refusal.message);

  const audit = (extra: Record<string, unknown> = {}) => db.audit({
    action: `content.${action}`, entityType: v.entityType, entityId: v.entityId,
    payload: { version_id: v.id, version: v.number, ...extra },
  });
  const set = async (sql: string, values: unknown[]) => {
    try {
      return await db.one<Version>(`UPDATE platform.content_versions SET ${sql} WHERE id = $1::bigint RETURNING ${VERSION}`, [v.id, ...values]);
    } catch (err) {
      // The trigger is the last word. Anything the rules above missed ends here.
      if ((err as { code?: string }).code === '23514') throw new HttpError(409, 'workflow_refused', (err as Error).message);
      throw err;
    }
  };

  switch (action) {
    case 'submit': {
      const problems = await problemsFor(db, v);
      if (problems.length) throw new HttpError(422, 'not_ready', 'This version is not ready for review yet.', { problems });
      const next = await set(`review_state = 'in_expert_review', submitted_by = $2`, [actor.id]);
      await audit();
      return next;
    }
    case 'approve': {
      const next = await set(`review_state = 'in_compliance_review', reviewed_by = $2`, [actor.id]);
      await audit();
      return next;
    }
    case 'reject': {
      const next = await set(`review_state = 'rejected', rejected_by = $2, rejection_notes = $3`, [actor.id, notes!.trim()]);
      await audit({ notes: notes!.trim() });
      return next;
    }
    case 'publish': {
      const problems = await problemsFor(db, v);
      if (problems.length) throw new HttpError(422, 'not_ready', 'This version can no longer be published as it stands.', { problems });
      // The version it replaces is retired first: one published version per entity.
      await db.query(
        `UPDATE platform.content_versions SET review_state = 'retired'
          WHERE entity_type = $1 AND entity_id = $2 AND review_state = 'published' AND id <> $3::bigint`,
        [v.entityType, v.entityId, v.id],
      );
      const next = await set(`review_state = 'published', published_by = $2`, [actor.id]);
      await applyLive(db, scope, next);
      await audit();
      return next;
    }
    case 'retire': {
      if (v.entityType !== 'course') throw new HttpError(400, 'invalid_request', 'Only a whole course can be withdrawn. Publish a revision to change a lesson.');
      const next = await set(`review_state = 'retired'`, []);
      await db.query(`UPDATE platform.courses SET review_state = 'retired', updated_at = now() WHERE id = $1`, [v.entityId]);
      await audit();
      return next;
    }
    case 'revise': {
      const next = await insertDraft(db, scope, actor, v.entityType, v.entityId, v.snapshot);
      await audit({ from_version: v.number, draft_version: next.number });
      return next;
    }
  }
}

/** Retires a course: its latest published version, and the course for learners. */
export async function retireCourse(db: ContentDb, scope: Scope, actor: Actor, courseId: string): Promise<Version> {
  const current = await db.maybeOne<{ id: string }>(
    bind(`SELECT id::text FROM platform.content_versions
           WHERE entity_type = 'course' AND entity_id = $1 AND review_state = 'published' AND ${OWNED}`, 2),
    [courseId, scope.owner],
  );
  if (!current) throw new HttpError(404, 'not_found', 'No published course with that id here.');
  return transition(db, scope, actor, current.id, 'retire', null);
}
