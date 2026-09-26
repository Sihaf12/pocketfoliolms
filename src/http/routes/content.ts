/**
 * The content routes, registered twice: in the studio for an academy's
 * private courses, and in the console (under /content) for platform
 * courses and the glossary. Each registration brings a runner that opens
 * its own unit of work and says who is acting; the workflow itself is
 * the same code, in content/workflow.ts.
 *
 * In the studio, platform courses are listed and readable but never
 * editable: an academy switches them on or off in its catalogue.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  courseDraftSchema, glossaryDraftSchema, lessonDraftSchema, type EntityKind, type GlossarySnapshot,
} from '../../content/model.js';
import {
  createCourse, createGlossaryTerm, createLesson, retireCourse, reviewQueue, saveDraft, transition,
  versionHistory, viewVersion, type Actor, type ContentDb, type CourseDraft, type LessonDraft, type Scope, type Version,
} from '../../content/workflow.js';
import type { ReviewAction } from '../../domain/review.js';
import { HttpError } from '../errors.js';
import { uuid } from '../schemas.js';

export interface ContentContext {
  db: ContentDb;
  scope: Scope;
  actor: Actor;
}

export type ContentRunner = <T>(req: FastifyRequest, fn: (ctx: ContentContext) => Promise<T>) => Promise<T>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function shape(v: Version) {
  return {
    ...v,
    createdAt: iso(v.createdAt), submittedAt: iso(v.submittedAt), reviewedAt: iso(v.reviewedAt),
    publishedAt: iso(v.publishedAt), rejectedAt: iso(v.rejectedAt), retiredAt: iso(v.retiredAt),
  };
}

const idParams = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } } as const;
const versionParams = {
  type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9]{1,18}$' } },
} as const;

export async function contentRoutes(app: FastifyInstance, opts: { run: ContentRunner; platform: boolean }): Promise<void> {
  const { run } = opts;

  app.get('/courses', async (req) =>
    run(req, async ({ db, scope }) => {
      const courses = await db.query(
        `SELECT c.id, c.slug, c.title, c.tier, c.review_state AS "liveState",
                (c.owner_tenant_id IS NULL AND $1::uuid IS NOT NULL) AS "readOnly",
                lv.id::text AS "versionId", lv.version AS "versionNumber", lv.review_state AS "versionState",
                json_build_object('published', lc.published, 'inReview', lc.in_review, 'draft', lc.draft, 'sentBack', lc.sent_back) AS "lessonCounts"
           FROM platform.courses c
           LEFT JOIN LATERAL (
             SELECT id, version, review_state FROM platform.content_versions
              WHERE entity_type = 'course' AND entity_id = c.id ORDER BY version DESC LIMIT 1) lv ON true
           -- Its lessons by where they stand: live ones are published, whatever
           -- revision is under way; the rest by their latest version.
           LEFT JOIN LATERAL (
             SELECT count(*) FILTER (WHERE s.live)::int AS published,
                    count(*) FILTER (WHERE NOT s.live AND s.state IN ('in_expert_review', 'in_compliance_review'))::int AS in_review,
                    count(*) FILTER (WHERE NOT s.live AND s.state = 'draft')::int AS draft,
                    count(*) FILTER (WHERE NOT s.live AND s.state = 'rejected')::int AS sent_back
               FROM (
                 SELECT EXISTS (SELECT 1 FROM platform.lessons l WHERE l.id = ids.id) AS live,
                        (SELECT v.review_state::text FROM platform.content_versions v
                          WHERE v.entity_type = 'lesson' AND v.entity_id = ids.id ORDER BY v.version DESC LIMIT 1) AS state
                   FROM (SELECT id FROM platform.lessons WHERE course_id = c.id
                         UNION
                         SELECT entity_id FROM platform.content_versions
                          WHERE entity_type = 'lesson' AND snapshot->>'courseId' = c.id::text) ids
               ) s) lc ON true
          WHERE c.owner_tenant_id IS NOT DISTINCT FROM $1::uuid
             OR ($1::uuid IS NOT NULL AND c.owner_tenant_id IS NULL AND c.review_state = 'published')
          ORDER BY c.tier, c.title`,
        [scope.owner],
      );
      return { courses };
    }));

  app.get<{ Params: { id: string } }>('/courses/:id', { schema: { params: idParams } }, async (req) =>
    run(req, async ({ db, scope }) => {
      const course = await db.maybeOne(
        `SELECT id, slug, title, tier, summary, est_minutes AS "estMinutes", review_state AS "liveState",
                (owner_tenant_id IS NULL AND $2::uuid IS NOT NULL) AS "readOnly"
           FROM platform.courses
          WHERE id = $1 AND (owner_tenant_id IS NOT DISTINCT FROM $2::uuid
                             OR ($2::uuid IS NOT NULL AND owner_tenant_id IS NULL AND review_state = 'published'))`,
        [req.params.id, scope.owner],
      );
      if (!course) throw new HttpError(404, 'not_found', 'No such course here.');
      // Lessons already live, and lessons that so far exist only as versions.
      const lessons = await db.query(
        `WITH ids AS (
           SELECT id FROM platform.lessons WHERE course_id = $1
           UNION
           SELECT entity_id FROM platform.content_versions WHERE entity_type = 'lesson' AND snapshot->>'courseId' = $1::text)
         SELECT ids.id, COALESCE(lv.snapshot->>'title', l.title) AS title,
                COALESCE((lv.snapshot->>'position')::int, l.position) AS position,
                l.id IS NOT NULL AS live, lv.id::text AS "versionId", lv.version AS "versionNumber", lv.review_state AS "versionState"
           FROM ids
           LEFT JOIN platform.lessons l ON l.id = ids.id
           LEFT JOIN LATERAL (
             SELECT id, version, review_state, snapshot FROM platform.content_versions
              WHERE entity_type = 'lesson' AND entity_id = ids.id ORDER BY version DESC LIMIT 1) lv ON true
          ORDER BY 3, 2`,
        [req.params.id],
      );
      return { course, lessons };
    }));

  app.post<{ Body: CourseDraft }>('/courses', { schema: { body: courseDraftSchema } }, async (req, reply) => {
    const version = await run(req, ({ db, scope, actor }) => createCourse(db, scope, actor, req.body));
    return reply.status(201).send({ version: shape(version) });
  });

  app.put<{ Params: { id: string }; Body: CourseDraft }>('/courses/:id/draft', { schema: { params: idParams, body: courseDraftSchema } }, async (req) =>
    ({ version: shape(await run(req, ({ db, scope, actor }) => saveDraft(db, scope, actor, 'course', req.params.id, req.body))) }));

  app.post<{ Params: { id: string }; Body: LessonDraft }>('/courses/:id/lessons', { schema: { params: idParams, body: lessonDraftSchema } }, async (req, reply) => {
    const version = await run(req, ({ db, scope, actor }) => createLesson(db, scope, actor, req.params.id, req.body));
    return reply.status(201).send({ version: shape(version) });
  });

  app.put<{ Params: { id: string }; Body: LessonDraft }>('/lessons/:id/draft', { schema: { params: idParams, body: lessonDraftSchema } }, async (req) =>
    ({ version: shape(await run(req, ({ db, scope, actor }) => saveDraft(db, scope, actor, 'lesson', req.params.id, req.body))) }));

  app.get<{ Params: { kind: EntityKind; id: string } }>('/entities/:kind/:id/versions', {
    schema: {
      params: {
        type: 'object', additionalProperties: false, required: ['kind', 'id'],
        properties: { kind: { type: 'string', enum: ['course', 'lesson', 'glossary_term'] }, id: uuid },
      },
    },
  }, async (req) =>
    run(req, async ({ db, scope }) => ({ versions: (await versionHistory(db, scope, req.params.kind, req.params.id)).map(shape) })));

  app.get<{ Params: { id: string } }>('/versions/:id', { schema: { params: versionParams } }, async (req) =>
    run(req, async ({ db, scope, actor }) => {
      const view = await viewVersion(db, scope, actor, req.params.id);
      return { ...view, version: shape(view.version) };
    }));

  app.get('/review/queue', async (req) =>
    run(req, async ({ db, scope, actor }) => ({
      items: (await reviewQueue(db, scope, actor)).map((i) => ({ ...i, submittedAt: iso(i.submittedAt) })),
    })));

  for (const action of ['submit', 'approve', 'publish', 'revise'] as const satisfies readonly ReviewAction[]) {
    app.post<{ Params: { id: string } }>(`/versions/:id/${action}`, { schema: { params: versionParams } }, async (req, reply) => {
      const version = await run(req, ({ db, scope, actor }) => transition(db, scope, actor, req.params.id, action, null));
      return reply.status(action === 'revise' ? 201 : 200).send({ version: shape(version) });
    });
  }

  app.post<{ Params: { id: string }; Body: { notes: string } }>('/versions/:id/reject', {
    schema: {
      params: versionParams,
      body: { type: 'object', additionalProperties: false, required: ['notes'], properties: { notes: { type: 'string', maxLength: 4000 } } },
    },
  }, async (req) =>
    ({ version: shape(await run(req, ({ db, scope, actor }) => transition(db, scope, actor, req.params.id, 'reject', req.body.notes))) }));

  app.post<{ Params: { kind: 'course'; id: string } }>('/entities/:kind/:id/retire', {
    schema: {
      params: {
        type: 'object', additionalProperties: false, required: ['kind', 'id'],
        properties: { kind: { type: 'string', enum: ['course'] }, id: uuid },
      },
    },
  }, async (req) =>
    ({ version: shape(await run(req, ({ db, scope, actor }) => retireCourse(db, scope, actor, req.params.id))) }));

  app.get('/glossary', async (req) =>
    run(req, async ({ db }) => ({
      terms: await db.query('SELECT id, term, definition, related FROM platform.glossary_terms ORDER BY lower(term)'),
      // On the console, terms still being written or reviewed, so a draft
      // can be found again before it has a live row.
      ...(opts.platform ? {
        inProgress: await db.query(
          `SELECT DISTINCT ON (entity_id) entity_id AS id, id::text AS "versionId", snapshot->>'term' AS term, review_state AS state
             FROM platform.content_versions
            WHERE entity_type = 'glossary_term' AND owner_tenant_id IS NULL
            ORDER BY entity_id, version DESC`,
        ).then((rows) => rows.filter((r) => !['published', 'retired'].includes(String(r.state)))),
      } : {}),
    })));

  if (opts.platform) {
    app.post<{ Body: GlossarySnapshot }>('/glossary', { schema: { body: glossaryDraftSchema } }, async (req, reply) => {
      const version = await run(req, ({ db, scope, actor }) => createGlossaryTerm(db, scope, actor, req.body));
      return reply.status(201).send({ version: shape(version) });
    });
    app.put<{ Params: { id: string }; Body: GlossarySnapshot }>('/glossary/:id/draft', { schema: { params: idParams, body: glossaryDraftSchema } }, async (req) =>
      ({ version: shape(await run(req, ({ db, scope, actor }) => saveDraft(db, scope, actor, 'glossary_term', req.params.id, req.body))) }));
  }
}
