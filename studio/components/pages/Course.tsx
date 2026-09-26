'use client';
/**
 * A course: its details and placement questions, where it stands in
 * review, and its lessons in order. Platform courses open read-only in
 * an academy's studio.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/api';
import type { CourseDetail, CourseSnapshot, Version, VersionView as View } from '@/lib/content';
import { TIER_NAME, TIERS, moment, type Tier } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Head, Loading, StateChip, TierChip } from '../bits';
import { ErrorScope, Field } from '../Form';
import { Icon } from '../Icon';
import { QuestionsEditor } from '../QuestionsEditor';
import { VersionActions } from '../VersionActions';
import { useWorkspace } from '../Workspace';

type Details = Pick<CourseSnapshot, 'title' | 'summary' | 'tier' | 'estMinutes'>;

function DetailsFields({ value, onChange }: { value: Details; onChange(v: Details): void }) {
  return (
    <>
      <Field label="Title" name="title">{(p) => <input {...p} className="input" maxLength={120} value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} />}</Field>
      <Field label="Summary" name="summary" hint="One line learners read before they start.">
        {(p) => <textarea {...p} className="textarea short-text" maxLength={300} value={value.summary} onChange={(e) => onChange({ ...value, summary: e.target.value })} />}
      </Field>
      <div className="grid-2">
        <Field label="Tier" name="tier">
          {(p) => (
            <select {...p} className="select" value={value.tier} onChange={(e) => onChange({ ...value, tier: e.target.value as Tier })}>
              {TIERS.map((t) => <option key={t} value={t}>{TIER_NAME[t]}</option>)}
            </select>
          )}
        </Field>
        <Field label="Minutes, all lessons together" name="estMinutes">
          {(p) => <input {...p} className="input short" type="number" min={1} max={600} value={value.estMinutes} onChange={(e) => onChange({ ...value, estMinutes: Number(e.target.value) })} />}
        </Field>
      </div>
    </>
  );
}

function Lessons({ detail, canWrite }: { detail: CourseDetail; canWrite: boolean }) {
  const ws = useWorkspace();
  const add = canWrite && !detail.course.readOnly
    ? <Link className="btn" href={ws.href(`/courses/${detail.course.id}/lessons/new`)}><Icon name="plus" />Add a lesson</Link>
    : null;
  return (
    <section aria-labelledby="lessons">
      <div className="spread section-head"><h2 id="lessons">Lessons</h2>{add}</div>
      {detail.lessons.length ? (
        <ol className="list">
          {detail.lessons.map((l) => (
            <li key={l.id}>
              <Link className="item" href={ws.href(`/lessons/${l.id}`)}>
                <span className="num">{l.position}</span>
                <span className="grow"><span className="title">{l.title}</span></span>
                <StateChip state={l.versionState ?? (l.live ? 'published' : null)} />
                <Icon name="next" />
              </Link>
            </li>
          ))}
        </ol>
      ) : <div className="card empty"><p>No lessons yet. A lesson is a few steps of reading, a video, and five check questions.</p>{add}</div>}
    </section>
  );
}

export function CoursePage({ courseId }: { courseId: string }) {
  const ws = useWorkspace();
  const detail = useLoad<CourseDetail>(ws.content(`/courses/${courseId}`));
  const history = useLoad<{ versions: Version<CourseSnapshot>[] }>(ws.content(`/entities/course/${courseId}/versions`));
  const latest = history.data?.versions[0];
  const view = useLoad<View<CourseSnapshot>>(latest ? ws.content(`/versions/${latest.id}`) : null);
  const reload = () => { detail.reload(); history.reload(); view.reload(); };

  if (!detail.data || !history.data || (latest && (!view.data || view.data.version.id !== latest.id))) {
    return <><Head title="Course" /><Loading error={detail.error ?? history.error ?? view.error} /></>;
  }
  const d = detail.data;
  const editable = !!latest && latest.state === 'draft' && !d.course.readOnly && ws.has('author');

  return (
    <>
      <Head title={d.course.title} back={{ href: ws.href('/'), label: 'Content' }}
        lead={<span className="row tight"><TierChip tier={d.course.tier} /><StateChip state={latest?.state ?? d.course.liveState} />{d.course.readOnly ? <span className="chip plain">Platform course, read-only</span> : null}</span>} />
      {editable && latest && view.data
        ? <CourseEditor key={latest.id} version={latest} actions={view.data.actions} onChanged={reload} />
        : <CourseSummary detail={d} view={view.data ?? null} onChanged={reload} />}
      <Lessons detail={d} canWrite={ws.has('author')} />
    </>
  );
}

function CourseSummary({ detail, view, onChanged }: { detail: CourseDetail; view: View<CourseSnapshot> | null; onChanged(): void }) {
  const ws = useWorkspace();
  const s = view?.version.snapshot;
  return (
    <section className="stack" aria-labelledby="about">
      <h2 id="about">About this course</h2>
      {view?.version.state === 'rejected' && view.version.rejectionNotes ? (
        <div className="notice danger"><p><b>Notes from the reviewer</b></p><p className="prewrap">{view.version.rejectionNotes}</p></div>
      ) : null}
      <dl className="dl">
        <dt>Summary</dt><dd>{s?.summary ?? detail.course.summary}</dd>
        <dt>Length</dt><dd>About {s?.estMinutes ?? detail.course.estMinutes} minutes</dd>
        {s ? <><dt>Placement questions</dt><dd>{s.placementQuestions.length}</dd></> : null}
      </dl>
      {view && view.actions.length ? (
        <VersionActions versionId={view.version.id} entityId={view.version.entityId} entityType="course" actions={view.actions}
          status={<>Version {view.version.number}. <Link href={ws.href(`/versions/${view.version.id}`)}>Read it as a reviewer</Link></>}
          onDone={() => onChanged()} />
      ) : null}
    </section>
  );
}

function CourseEditor({ version, actions, onChanged }: { version: Version<CourseSnapshot>; actions: View['actions']; onChanged(): void }) {
  const ws = useWorkspace();
  const [draft, setDraft] = useState<CourseSnapshot>(version.snapshot);
  const [saved, setSaved] = useState(JSON.stringify(version.snapshot));
  const [savedAt, setSavedAt] = useState<string>(version.createdAt);
  const [error, setError] = useState<unknown>(null);
  const dirty = JSON.stringify(draft) !== saved;

  async function save(): Promise<boolean> {
    if (!dirty) return true;
    setError(null);
    try {
      const res = await call<{ version: Version<CourseSnapshot> }>(ws.content(`/courses/${version.entityId}/draft`), { method: 'PUT', body: draft });
      setDraft(res.version.snapshot);
      setSaved(JSON.stringify(res.version.snapshot));
      setSavedAt(new Date().toISOString());
      return true;
    } catch (err) {
      ws.handle(err);
      setError(err);
      return false;
    }
  }

  return (
    <section className="stack form-width" aria-labelledby="about">
      <h2 id="about">About this course</h2>
      <ErrorScope error={error}>
      <DetailsFields value={draft} onChange={(v) => setDraft({ ...draft, ...v })} />
      <h3>Placement questions</h3>
      <p className="soft">Optional. They help place a new learner on the path; each one measures one tier.</p>
      <QuestionsEditor questions={draft.placementQuestions} path="placementQuestions" withTier noun="placement question"
        onChange={(q) => setDraft({ ...draft, placementQuestions: q.map((x) => ({ ...x, tier: x.tier ?? 'learn' })) })} />
      <VersionActions versionId={version.id} entityId={version.entityId} entityType="course" actions={actions.filter((a) => a === 'submit')}
        status={dirty ? 'Unsaved changes.' : `Saved ${moment(savedAt)}.`} before={save} onDone={() => onChanged()} onError={(err) => { ws.handle(err); setError(err); }}
        secondary={<button type="button" className="btn" disabled={!dirty} onClick={() => void save().then((ok) => ok && ws.say('Draft saved'))}>Save draft</button>} />
      </ErrorScope>
    </section>
  );
}

export function NewCoursePage() {
  const ws = useWorkspace();
  const router = useRouter();
  const [value, setValue] = useState<Details>({ title: '', summary: '', tier: 'learn', estMinutes: 30 });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await call<{ version: Version }>(ws.content('/courses'), { method: 'POST', body: { ...value, placementQuestions: [] } });
      ws.say('Course draft created');
      router.replace(ws.href(`/courses/${res.version.entityId}`));
    } catch (err) {
      ws.handle(err);
      setError(err);
      setBusy(false);
    }
  }

  return (
    <>
      <Head title="Start a new course" back={{ href: ws.href('/'), label: 'Content' }}
        lead="A draft nobody outside the studio sees until compliance publishes it." />
      <form className="stack narrow" onSubmit={create}>
        <ErrorScope error={error}>
        <DetailsFields value={value} onChange={setValue} />
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy || !value.title.trim()}>Create course draft</button>
        </div>
        </ErrorScope>
      </form>
    </>
  );
}
