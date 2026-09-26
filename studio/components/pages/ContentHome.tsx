'use client';
/**
 * Every course this person can work on, and where each stands. In an
 * academy's studio, platform courses are listed apart: they are read
 * here and offered or hidden in the catalogue, never edited.
 */
import Link from 'next/link';
import { useLoad } from '@/lib/useLoad';
import type { ReviewState, Tier } from '@/lib/format';
import { Head, Loading, StateChip, TierChip } from '../bits';
import { Icon } from '../Icon';
import { useWorkspace } from '../Workspace';

export interface CourseRow {
  id: string;
  title: string;
  tier: Tier;
  liveState: ReviewState;
  readOnly: boolean;
  versionId: string | null;
  versionState: ReviewState | null;
  lessonCounts: { published: number; inReview: number; draft: number; sentBack: number };
}

/** "1 lesson published, 2 in draft": the course's lessons by where they stand. */
export function lessonSummary(c: CourseRow['lessonCounts']): string {
  const parts = ([[c.published, 'published'], [c.inReview, 'in review'], [c.draft, 'in draft'], [c.sentBack, 'sent back']] as const)
    .filter(([n]) => n > 0);
  if (!parts.length) return 'No lessons yet';
  return parts.map(([n, label], i) => (i === 0 ? `${n} ${n === 1 ? 'lesson' : 'lessons'} ${label}` : `${n} ${label}`)).join(', ');
}

function Rows({ courses }: { courses: CourseRow[] }) {
  const ws = useWorkspace();
  return (
    <ul className="list">
      {courses.map((c) => (
        <li key={c.id}>
          <Link href={ws.href(`/courses/${c.id}`)} className="item">
            <span className="grow">
              <span className="title">{c.title}</span>
              <span className="row tight">
                <TierChip tier={c.tier} />
                {/* The course's own state, then its lessons', so neither is taken for the other. */}
                <span className="course-state">
                  <span className="visually-hidden">Course: </span>
                  <StateChip state={c.versionState ?? c.liveState} />
                  <span className="small">{lessonSummary(c.lessonCounts)}</span>
                </span>
              </span>
            </span>
            <Icon name="next" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ContentHome() {
  const ws = useWorkspace();
  const { data, error } = useLoad<{ courses: CourseRow[] }>(ws.content('/courses'));
  const canWrite = ws.has('author');
  const create = canWrite
    ? <Link className="btn primary" href={ws.href('/courses/new')}><Icon name="plus" />Start a new course</Link>
    : null;

  if (!data) return <><Head title="Content" /><Loading error={error} /></>;
  const own = data.courses.filter((c) => !c.readOnly);
  const platform = data.courses.filter((c) => c.readOnly);

  return (
    <>
      <Head
        title={ws.kind === 'studio' ? 'Content' : 'Platform content'}
        lead={ws.kind === 'studio'
          ? 'Your academy\'s own courses, and the platform\'s courses your learners can take.'
          : 'The curriculum every academy can offer. Nothing here reaches a learner until compliance publishes it.'}
      >
        {create}
      </Head>

      <section aria-labelledby="own">
        <h2 id="own">{ws.kind === 'studio' ? 'Your academy\'s courses' : 'Courses'}</h2>
        {own.length ? <Rows courses={own} /> : (
          <div className="card empty">
            <p>{canWrite
              ? 'Nothing here yet. A course starts with a title and a tier; lessons come next.'
              : 'Nothing here yet. Authors start courses; you will see them once they exist.'}</p>
            {create}
          </div>
        )}
      </section>

      {ws.kind === 'studio' ? (
        <section aria-labelledby="platform">
          <h2 id="platform">Platform courses</h2>
          <p className="soft lead">
            Written and reviewed by the platform.{' '}
            {ws.isAdmin ? <>Choose which ones learners see in the <Link href={ws.href('/catalogue')}>catalogue</Link>.</> : 'Your admins choose which ones learners see.'}
          </p>
          <Rows courses={platform} />
        </section>
      ) : null}
    </>
  );
}
