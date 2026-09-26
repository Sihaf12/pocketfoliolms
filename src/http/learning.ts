/**
 * Reads shared by the pathway, lesson and profile routes. Every query
 * runs inside the request's unit of work, so RLS scopes it to the
 * academy; the user filter is authorisation within that academy.
 */
import type { ScopedDb } from '../db/unitOfWork.js';

/** Lessons this learner has a passed knowledge check for. */
export async function passedLessons(db: ScopedDb, userId: string): Promise<Set<string>> {
  const rows = await db.query<{ lessonId: string }>(
    `SELECT DISTINCT lesson_id AS "lessonId" FROM app.quiz_attempts
      WHERE user_id = $1 AND kind = 'knowledge_check' AND passed AND lesson_id IS NOT NULL`,
    [userId],
  );
  return new Set(rows.map((r) => r.lessonId));
}

/** For each lesson, the titles of the lessons it requires that the learner has not passed. */
export async function unmetPrerequisites(
  db: ScopedDb,
  userId: string,
  lessonIds: readonly string[],
): Promise<Map<string, string[]>> {
  const rows = await db.query<{ lessonId: string; title: string }>(
    `SELECT p.lesson_id AS "lessonId", r.title
       FROM platform.lesson_prerequisites p
       JOIN platform.lessons r ON r.id = p.requires_lesson_id
       JOIN platform.courses rc ON rc.id = r.course_id
      WHERE p.lesson_id = ANY($2::uuid[])
        AND NOT EXISTS (
          SELECT 1 FROM app.quiz_attempts a
           WHERE a.user_id = $1 AND a.lesson_id = p.requires_lesson_id
             AND a.kind = 'knowledge_check' AND a.passed)
      ORDER BY rc.tier, r.position, r.title`,
    [userId, lessonIds],
  );
  const unmet = new Map<string, string[]>();
  for (const r of rows) unmet.set(r.lessonId, [...(unmet.get(r.lessonId) ?? []), r.title]);
  return unmet;
}

/** Every requirement of the given lessons, met or not, as lesson ids. */
export async function prerequisitesOf(db: ScopedDb, lessonIds: readonly string[]): Promise<Map<string, string[]>> {
  const rows = await db.query<{ lessonId: string; requiresId: string }>(
    `SELECT lesson_id AS "lessonId", requires_lesson_id AS "requiresId"
       FROM platform.lesson_prerequisites WHERE lesson_id = ANY($1::uuid[])`,
    [lessonIds],
  );
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.lessonId, [...(out.get(r.lessonId) ?? []), r.requiresId]);
  return out;
}
