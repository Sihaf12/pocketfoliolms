'use client';
/**
 * Writing a lesson, with the learner's view of it beside the text: on a
 * desktop side by side, on a phone one tap apart. A lesson that is not a
 * draft this person can edit opens as its version instead, with the
 * review actions the API allows.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { lessonProblems } from '../../../packages/shared/markdown';
import { call } from '@/lib/api';
import {
  MIN_CHECK_QUESTIONS, lessonDraftBody, type CourseDetail, type LessonSnapshot, type Version, type VersionView as View,
} from '@/lib/content';
import { moment } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Head, Loading, StateChip } from '../bits';
import { Field, Problem } from '../Form';
import { LessonPreview } from '../LessonPreview';
import { QuestionsEditor, TranscriptEditor } from '../QuestionsEditor';
import { VersionActions } from '../VersionActions';
import { useWorkspace } from '../Workspace';
import { VersionScreen } from './Version';

/** What stops a lesson going to review, worked out as the author types. The API checks again. */
function readiness(l: LessonSnapshot): string[] {
  const problems = [...lessonProblems(l.bodyMd)];
  if (!l.title.trim()) problems.unshift('Give the lesson a title.');
  if (l.questions.length < MIN_CHECK_QUESTIONS) {
    problems.push(`Add ${MIN_CHECK_QUESTIONS - l.questions.length} more check question${MIN_CHECK_QUESTIONS - l.questions.length === 1 ? '' : 's'}: a lesson needs ${MIN_CHECK_QUESTIONS}.`);
  }
  l.questions.forEach((q, i) => {
    if (!q.prompt.trim()) problems.push(`Question ${i + 1} needs its question.`);
    if (q.options.some((o) => !o.text.trim())) problems.push(`Question ${i + 1} has an empty option.`);
    if (q.options.some((o) => !(q.rationales[o.key] ?? '').trim())) problems.push(`Question ${i + 1}: every option needs a rationale.`);
  });
  return problems;
}

function Editor({ course, initial, version, actions, onChanged }: {
  course: CourseDetail;
  initial: LessonSnapshot;
  /** Absent for a lesson not yet created. */
  version?: Version<LessonSnapshot>;
  actions: View['actions'];
  onChanged(): void;
}) {
  const ws = useWorkspace();
  const router = useRouter();
  const [draft, setDraft] = useState<LessonSnapshot>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [savedAt, setSavedAt] = useState<string | null>(version?.createdAt ?? null);
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== saved;
  const problems = useMemo(() => readiness(draft), [draft]);
  const set = <K extends keyof LessonSnapshot>(key: K, value: LessonSnapshot[K]) => setDraft((d) => ({ ...d, [key]: value }));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!version) return false;
    if (!dirty) return true;
    setError(null);
    try {
      const res = await call<{ version: Version<LessonSnapshot> }>(ws.content(`/lessons/${version.entityId}/draft`), {
        method: 'PUT', body: lessonDraftBody(draft),
      });
      // The server gives new questions their ids; take its snapshot as the saved state.
      setDraft(res.version.snapshot);
      setSaved(JSON.stringify(res.version.snapshot));
      setSavedAt(new Date().toISOString());
      return true;
    } catch (err) {
      ws.handle(err);
      setError(err);
      return false;
    }
  }, [version, dirty, draft, ws]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await call<{ version: Version<LessonSnapshot> }>(ws.content(`/courses/${course.course.id}/lessons`), {
        method: 'POST', body: lessonDraftBody(draft),
      });
      setSaved(JSON.stringify(draft));
      ws.say('Lesson draft created');
      router.replace(ws.href(`/lessons/${res.version.entityId}`));
    } catch (err) {
      ws.handle(err);
      setError(err);
      setBusy(false);
    }
  }

  const siblings = course.lessons.filter((l) => l.id !== version?.entityId);
  const status = !version ? 'Not saved yet.' : dirty ? 'Unsaved changes.' : savedAt ? `Saved ${moment(savedAt)}.` : 'Saved.';

  return (
    <>
      <Head
        title={draft.title.trim() || 'New lesson'}
        back={{ href: ws.href(`/courses/${course.course.id}`), label: course.course.title }}
        lead={version ? <span className="row tight"><StateChip state={version.state} /><span>Version {version.number}</span></span> : 'A draft only you and your reviewers see.'}
      />

      <div className="segmented phone-only" role="group" aria-label="Show">
        <button type="button" aria-pressed={view === 'write'} onClick={() => setView('write')}>Write</button>
        <button type="button" aria-pressed={view === 'preview'} onClick={() => setView('preview')}>Preview</button>
      </div>

      <div className="editor" data-view={view}>
        <div className="editor-form stack form-width">
          <Problem error={error} />
          {problems.length ? (
            <div className="notice caution" aria-live="polite">
              <p><b>Before it can go to review</b></p>
              <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          ) : <div className="notice success" aria-live="polite"><p>Ready to send for review.</p></div>}

          <section className="stack" aria-labelledby="the-lesson">
            <h2 id="the-lesson">The lesson</h2>
            <Field label="Title">{(p) => <input {...p} className="input" maxLength={120} value={draft.title} onChange={(e) => set('title', e.target.value)} />}</Field>
            <Field label="Lesson text" hint={<>Start each step with <code>## </code> and its heading. One callout: a paragraph starting <code>&gt; **In practice**</code>. <code>**bold**</code> for emphasis, <code>[[term|definition]]</code> for a glossary term.</>}>
              {(p) => <textarea {...p} className="textarea body" maxLength={20000} value={draft.bodyMd} onChange={(e) => set('bodyMd', e.target.value)} />}
            </Field>
          </section>

          <section className="stack" aria-labelledby="details">
            <h2 id="details">Details</h2>
            <div className="grid-2">
              <Field label="Position in the course">{(p) => <input {...p} className="input short" type="number" min={1} max={200} value={draft.position} onChange={(e) => set('position', Number(e.target.value))} />}</Field>
              <Field label="Minutes to read and watch">{(p) => <input {...p} className="input short" type="number" min={1} max={60} value={draft.minutes} onChange={(e) => set('minutes', Number(e.target.value))} />}</Field>
              <Field label="XP for passing its check">{(p) => <input {...p} className="input short" type="number" min={0} max={1000} value={draft.xp} onChange={(e) => set('xp', Number(e.target.value))} />}</Field>
              <Field label="Video" hint="Its name in the media store, not a web address.">{(p) => <input {...p} className="input" value={draft.videoAsset ?? ''} onChange={(e) => set('videoAsset', e.target.value.trim() ? e.target.value : null)} />}</Field>
            </div>
          </section>

          <section className="stack" aria-labelledby="transcript">
            <h2 id="transcript">Video transcript</h2>
            <TranscriptEditor lines={draft.transcript} onChange={(lines) => set('transcript', lines)} />
          </section>

          {siblings.length ? (
            <section className="stack" aria-labelledby="requires">
              <h2 id="requires">Lessons to finish first</h2>
              <fieldset>
                <legend className="visually-hidden">Lessons to finish first</legend>
                {siblings.map((l) => (
                  <label className="check" key={l.id}>
                    <input type="checkbox" checked={draft.requires.includes(l.id)}
                      onChange={(e) => set('requires', e.target.checked ? [...draft.requires, l.id] : draft.requires.filter((r) => r !== l.id))} />
                    {l.position}. {l.title}
                  </label>
                ))}
              </fieldset>
            </section>
          ) : null}

          <section className="stack" aria-labelledby="questions">
            <h2 id="questions">Check questions</h2>
            <QuestionsEditor questions={draft.questions} min={MIN_CHECK_QUESTIONS} onChange={(q) => set('questions', q)} />
          </section>
        </div>

        {/* It scrolls on its own beside the form, so the keyboard can reach it. */}
        <aside className="editor-preview" aria-label="Learner preview" tabIndex={0}>
          <LessonPreview lesson={{ ...draft, tier: course.course.tier, courseTitle: course.course.title }} />
        </aside>
      </div>

      {version ? (
        <VersionActions
          versionId={version.id} entityId={version.entityId} entityType="lesson" actions={actions.filter((a) => a === 'submit')}
          status={status} before={save} onDone={() => onChanged()}
          secondary={<button type="button" className="btn" disabled={!dirty} onClick={() => void save().then((ok) => ok && ws.say('Draft saved'))}>Save draft</button>}
        />
      ) : (
        <div className="actions">
          <p className="status">{status}</p>
          <button type="button" className="btn primary" disabled={busy || !draft.title.trim()} onClick={() => void create()}>Create lesson draft</button>
        </div>
      )}
    </>
  );
}

export function LessonPage({ lessonId }: { lessonId: string }) {
  const ws = useWorkspace();
  const history = useLoad<{ versions: Version<LessonSnapshot>[] }>(ws.content(`/entities/lesson/${lessonId}/versions`));
  const latest = history.data?.versions[0];
  const view = useLoad<View<LessonSnapshot>>(latest ? ws.content(`/versions/${latest.id}`) : null);
  const course = useLoad<CourseDetail>(latest ? ws.content(`/courses/${latest.snapshot.courseId}`) : null);
  const reload = () => { history.reload(); view.reload(); course.reload(); };

  if (history.data && !latest) return <><Head title="Lesson" /><p>No such lesson here.</p></>;
  if (!latest || !view.data || !course.data || view.data.version.id !== latest.id) {
    return <><Head title="Lesson" /><Loading error={history.error ?? view.error ?? course.error} /></>;
  }
  const editable = latest.state === 'draft' && !view.data.readOnly && ws.has('author');
  if (editable) {
    return <Editor key={latest.id} course={course.data} initial={latest.snapshot} version={latest} actions={view.data.actions} onChanged={reload} />;
  }
  return <VersionScreen view={view.data} course={course.data} onChanged={reload} />;
}

export function NewLessonPage({ courseId }: { courseId: string }) {
  const ws = useWorkspace();
  const course = useLoad<CourseDetail>(ws.content(`/courses/${courseId}`));
  if (!course.data) return <><Head title="New lesson" /><Loading error={course.error} /></>;
  const next = Math.max(0, ...course.data.lessons.map((l) => l.position)) + 1;
  const blank: LessonSnapshot = {
    courseId, position: next, title: '', bodyMd: '', videoAsset: null, transcript: [], minutes: 8, xp: 90, requires: [], questions: [],
  };
  return <Editor course={course.data} initial={blank} actions={[]} onChanged={() => undefined} />;
}
