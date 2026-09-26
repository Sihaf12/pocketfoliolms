'use client';
/**
 * One version, as a reviewer reads it: what it says, what changed against
 * the live content, who has handled it so far, and what this person can
 * do next. A lesson is shown the way a learner will see it.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  CourseDetail, CourseSnapshot, GlossarySnapshot, LessonSnapshot, VersionView as View,
} from '@/lib/content';
import { FIELD_NAME, TIER_NAME, day, type Action } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Head, Loading, StateChip } from '../bits';
import { AfterPublish } from '../AfterPublish';
import { LessonPreview } from '../LessonPreview';
import { QuestionsEditor } from '../QuestionsEditor';
import { VersionActions } from '../VersionActions';
import { useWorkspace } from '../Workspace';

function titleOf(view: View): string {
  const s = view.version.snapshot as Partial<LessonSnapshot & GlossarySnapshot>;
  return s.title ?? s.term ?? 'Untitled';
}

function History({ view }: { view: View }) {
  const v = view.version;
  const who = (id: string | null) => (id ? view.people[id] ?? 'someone' : null);
  const lines: string[] = [];
  if (who(v.createdBy)) lines.push(`Drafted by ${who(v.createdBy)}, ${day(v.createdAt)}.`);
  if (v.submittedAt) lines.push(`Sent for review by ${who(v.submittedBy) ?? 'the author'}, ${day(v.submittedAt)}.`);
  if (v.reviewedAt) lines.push(`Approved by ${who(v.reviewedBy) ?? 'a reviewer'}, ${day(v.reviewedAt)}.`);
  if (v.publishedAt) lines.push(`Published by ${who(v.publishedBy) ?? 'compliance'}, ${day(v.publishedAt)}.`);
  if (v.rejectedAt) lines.push(`Sent back by ${who(v.rejectedBy) ?? 'a reviewer'}, ${day(v.rejectedAt)}.`);
  if (!lines.length) return null;
  return <ol className="history">{lines.map((l) => <li key={l}>{l}</li>)}</ol>;
}

export function VersionScreen({ view, course, done, onChanged }: {
  view: View;
  course?: CourseDetail | null;
  /** The action this person just took here, for the confirmation that follows it. */
  done?: Action | null;
  onChanged(action?: Action): void;
}) {
  const ws = useWorkspace();
  const router = useRouter();
  const v = view.version;
  const home = v.entityType === 'lesson'
    ? { href: ws.href(`/courses/${(v.snapshot as LessonSnapshot).courseId}`), label: course?.course.title ?? 'Course' }
    : v.entityType === 'course'
      ? { href: ws.href(`/courses/${v.entityId}`), label: course?.course.title ?? 'Course' }
      : { href: ws.href('/glossary'), label: 'Glossary' };
  const editorOf = (entityId: string) => ws.href(v.entityType === 'lesson' ? `/lessons/${entityId}` : v.entityType === 'course' ? `/courses/${entityId}` : `/glossary/${entityId}`);

  return (
    <>
      <Head title={titleOf(view)} back={home}
        lead={<span className="row tight"><StateChip state={v.state} /><span>Version {v.number}</span></span>} />

      <div className="version">
        <div className="stack version-side">
          {done === 'publish' && v.state === 'published' ? <AfterPublish kind={v.entityType} course={course} /> : null}
          {view.readOnly ? <div className="notice"><p>Platform content. Your academy can offer or hide it in the catalogue; it is edited on the platform.</p></div> : null}
          {v.state === 'rejected' && v.rejectionNotes ? (
            <div className="notice danger"><p><b>Notes from the reviewer</b></p><p className="prewrap">{v.rejectionNotes}</p></div>
          ) : null}
          {view.isNew && v.state !== 'published' ? <p className="soft">The first version: nothing of it is live yet.</p> : null}
          {view.changedFields.length ? (
            <div className="stack-sm">
              <p className="soft small">Changed since the live version</p>
              <p className="row tight">{view.changedFields.map((f) => <span className="chip plain" key={f}>{FIELD_NAME[f] ?? f}</span>)}</p>
            </div>
          ) : null}
          <History view={view} />

          {v.entityType === 'course' ? <CourseBody snapshot={v.snapshot as CourseSnapshot} /> : null}
          {v.entityType === 'glossary_term' ? <GlossaryBody snapshot={v.snapshot as GlossarySnapshot} /> : null}
          {v.entityType === 'lesson' ? <LessonFacts snapshot={v.snapshot as LessonSnapshot} course={course ?? null} /> : null}
        <VersionActions versionId={v.id} entityId={v.entityId} entityType={v.entityType} actions={view.actions}
          onDone={(next, action) => {
            // A revision of a lesson or term opens on this same page, as its editor.
            onChanged(action);
            if (action === 'revise') router.push(editorOf(next.entityId));
          }} />
        </div>
        {v.entityType === 'lesson' ? (
          <LessonPreview lesson={{
            ...(v.snapshot as LessonSnapshot),
            tier: course?.course.tier ?? 'learn',
            courseTitle: course?.course.title ?? 'this course',
          }} />
        ) : null}
      </div>

    </>
  );
}

function LessonFacts({ snapshot, course }: { snapshot: LessonSnapshot; course: CourseDetail | null }) {
  const names = new Map((course?.lessons ?? []).map((l) => [l.id, l.title]));
  return (
    <dl className="dl">
      <dt>Position</dt><dd>{snapshot.position}</dd>
      <dt>Length</dt><dd>{snapshot.minutes} minutes, {snapshot.xp} XP</dd>
      <dt>Video</dt><dd>{snapshot.videoAsset ?? 'None'}</dd>
      <dt>Transcript</dt><dd>{snapshot.transcript.length ? `${snapshot.transcript.length} lines` : 'None'}</dd>
      <dt>Finish first</dt><dd>{snapshot.requires.length ? snapshot.requires.map((id) => names.get(id) ?? 'another lesson').join(', ') : 'Nothing'}</dd>
      <dt>Check questions</dt><dd>{snapshot.questions.length}</dd>
    </dl>
  );
}

function CourseBody({ snapshot }: { snapshot: CourseSnapshot }) {
  return (
    <>
      <dl className="dl">
        <dt>Tier</dt><dd>{TIER_NAME[snapshot.tier]}</dd>
        <dt>Summary</dt><dd>{snapshot.summary}</dd>
        <dt>Length</dt><dd>About {snapshot.estMinutes} minutes</dd>
      </dl>
      {snapshot.placementQuestions.length ? (
        <section className="stack" aria-labelledby="placement">
          <h2 id="placement">Placement questions</h2>
          <QuestionsEditor questions={snapshot.placementQuestions} withTier readOnly onChange={() => undefined} />
        </section>
      ) : null}
    </>
  );
}

function GlossaryBody({ snapshot }: { snapshot: GlossarySnapshot }) {
  return (
    <dl className="dl">
      <dt>Term</dt><dd>{snapshot.term}</dd>
      <dt>Definition</dt><dd>{snapshot.definition}</dd>
      <dt>Related</dt><dd>{snapshot.related.length ? snapshot.related.join(', ') : 'None'}</dd>
    </dl>
  );
}

/** /versions/:id, where the review queue leads. */
export function VersionPage({ versionId }: { versionId: string }) {
  const ws = useWorkspace();
  const [done, setDone] = useState<Action | null>(null);
  const view = useLoad<View>(ws.content(`/versions/${versionId}`));
  const v = view.data?.version;
  // The course a lesson belongs to, or the course itself: what a publish here leads to depends on it.
  const courseId = v?.entityType === 'lesson' ? (v.snapshot as Partial<LessonSnapshot>).courseId : v?.entityType === 'course' ? v.entityId : undefined;
  const course = useLoad<CourseDetail>(courseId ? ws.content(`/courses/${courseId}`) : null);
  if (!view.data) return <><Head title="Version" /><Loading error={view.error} /></>;
  if (courseId && !course.data) return <><Head title={titleOf(view.data)} /><Loading error={course.error} /></>;
  return <VersionScreen view={view.data} course={course.data} done={done}
    onChanged={(action) => { setDone(action ?? null); view.reload(); course.reload(); }} />;
}
