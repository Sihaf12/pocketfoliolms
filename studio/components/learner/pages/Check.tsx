'use client';
/**
 * The knowledge check: three questions drawn by the server, answered one
 * at a time. Each answer is recorded and marked as it is given, and its
 * rationale unfolds beneath the options. After the third the paper is
 * submitted, and the server grades it: two of three verifies the lesson.
 *
 * The verified moment: the ring fills, the tick lands, the XP counts up,
 * and one small burst. A miss says what is needed and offers another go.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { call } from '@/lib/api';
import { Problem } from '../form';
import { STAR_PATH } from '../icons';
import { Scene } from '../Scene';
import { SkipLink } from '../Shell';
import { useMe } from '../context';
import type { LessonData } from './Lesson';
import { TIER_NAME } from './Start';

interface Question { id: string; prompt: string; options: { key: string; text: string }[] }
interface Paper { attemptId: string; questions: Question[]; passMark: number }
interface Marked { chosen: string; correct: boolean; correctKey: string; rationale: string }
interface Result { correct: number; total: number; passed: boolean; stars: number; certificate: { serial: string; courseTitle: string } | null }

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function Stars({ marks, small }: { marks: (boolean | undefined)[]; small?: boolean }) {
  return (
    <div className={`stars ${small ? 'mstars' : ''}`} role="img" aria-label={`${marks.filter(Boolean).length} of 3 correct so far`}>
      {[0, 1, 2].map((i) => (
        <svg key={i} viewBox="0 0 24 24" className={marks[i] === true ? 'g' : marks[i] === false ? 'w' : 'e'} aria-hidden="true"><path d={STAR_PATH} /></svg>
      ))}
    </div>
  );
}

function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced()) { setN(to); return; }
    let raf = 0;
    const t0 = performance.now() + 150;
    const f = (t: number) => {
      const p = Math.max(0, Math.min(1, (t - t0) / 900));
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>+{n}</>;
}

function Verified({ result, lesson, retry }: { result: Result; lesson: LessonData; retry(): void }) {
  const first = useRef<HTMLElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const colours = ['var(--safeguard)', 'var(--accent)', 'var(--brand)', 'var(--learn)'];
  return (
    <div className="veil">
      <div className="won" role="dialog" aria-modal="true" aria-labelledby="won-title">
        <div className="ring" aria-hidden="true">
          <svg viewBox="0 0 96 96"><circle className="bg" cx="48" cy="48" r="42" /><circle className={`fg ${result.passed ? '' : 'miss'}`} cx="48" cy="48" r="42" /></svg>
          <div className={`tick ${result.passed ? '' : 'miss'}`}>
            <svg viewBox="0 0 24 24">{result.passed ? <path d="M5 12l5 5L19 7" /> : <path d="M12 8v5M12 16h.01" />}</svg>
          </div>
          {result.passed ? (
            <div className="burst">
              {Array.from({ length: 18 }, (_, i) => {
                const ang = (i / 18) * Math.PI * 2 + (i % 2 ? 0.2 : 0);
                const d = 58 + (i % 3) * 16;
                return <i key={i} style={{ background: colours[i % 4], '--dx': `${Math.cos(ang) * d}px`, '--dy': `${Math.sin(ang) * d}px`, '--r': `${(i * 47) % 360}deg` } as React.CSSProperties} />;
              })}
            </div>
          ) : null}
        </div>
        <h2 id="won-title">{result.passed ? 'Verified' : 'Not this time'}</h2>
        <p>
          {result.correct} of {result.total} correct.{' '}
          {result.passed ? `${lesson.title} now counts towards your certificate.` : 'Two of three are needed. The lesson is open, and the questions change each time.'}
        </p>
        {result.passed ? <div className="xp" aria-label={`${lesson.xp} XP`}><CountUp to={lesson.xp} /><small>XP</small></div> : null}
        {result.certificate ? <p>You have finished {result.certificate.courseTitle}. Your certificate is issued.</p> : null}
        <div className="acts">
          {result.passed ? (
            <>
              <Link ref={first as React.Ref<HTMLAnchorElement>} className="btn" href="/path">See my path</Link>
              {result.certificate ? <Link className="btn sec" href={`/progress#cert-${result.certificate.serial}`}>See my certificate</Link> : null}
            </>
          ) : (
            <>
              <button ref={first as React.Ref<HTMLButtonElement>} className="btn" type="button" onClick={retry}>Try again</button>
              <Link className="btn sec" href={`/learn/${lesson.id}`}>Back to lesson</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function CheckPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { refresh } = useMe(true);
  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [qi, setQi] = useState(0);
  const [marks, setMarks] = useState<Marked[]>([]);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);

  const draw = useCallback(() => {
    setPaper(null); setQi(0); setMarks([]); setOpen(false); setResult(null); setError(null);
    call<Paper>(`/api/v1/lessons/${id}/checks`, { method: 'POST' }).then(setPaper).catch(setError);
  }, [id]);

  useEffect(() => {
    call<LessonData>(`/api/v1/lessons/${id}`).then(setLesson).catch(() => router.replace(`/learn/${id}`));
    draw();
  }, [id, draw, router]);

  const q = paper?.questions[qi];
  const mark = marks[qi];

  const answer = useCallback(async (key: string) => {
    if (!paper || !q || mark || busy) return;
    setBusy(true);
    try {
      const m = await call<Omit<Marked, 'chosen'>>(`/api/v1/checks/${paper.attemptId}/answers`, { method: 'POST', body: { questionId: q.id, key } });
      setMarks((all) => { const next = [...all]; next[qi] = { ...m, chosen: key }; return next; });
      // The rationale unfolds on the frame after it is in the page, so the row can grow.
      requestAnimationFrame(() => requestAnimationFrame(() => { setOpen(true); nextBtn.current?.focus({ preventScroll: true }); }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [paper, q, mark, busy, qi]);

  async function next() {
    if (!paper) return;
    if (qi < paper.questions.length - 1) {
      setQi(qi + 1); setOpen(false);
      requestAnimationFrame(() => heading.current?.focus());
      return;
    }
    setBusy(true);
    try {
      const answers = Object.fromEntries(paper.questions.map((x, i) => [x.id, marks[i]!.chosen]));
      setResult(await call<Result>(`/api/v1/checks/${paper.attemptId}/submission`, { method: 'POST', body: { answers } }));
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || result) return;
      const k = 'abc'.indexOf(e.key.toLowerCase());
      if (k >= 0 && q?.options[k] && !mark) { e.preventDefault(); void answer(q.options[k]!.key); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [q, mark, answer, result]);

  // The pass mark comes with the paper: the server's rule, only counted down here.
  const got = marks.filter((m) => m?.correct).length;
  const total = paper?.questions.length ?? 3;
  const left = total - marks.filter(Boolean).length;
  const need = Math.max(0, (paper?.passMark ?? total) - got);
  const standing = !need ? 'Enough to verify. The rest are a bonus.' : need > left ? 'Not enough left to verify this time. Finish anyway, then try again.' : `${need} more correct to verify.`;

  return (
    <div className="screen">
      <SkipLink />
      <header className="topbar"><div className="wrap">
        <Link className="back" href={`/learn/${id}`} style={{ margin: 0 }}>← Back to lesson</Link>
        <span className="chip" style={{ marginLeft: 'auto' }}>{qi + 1} of {paper?.questions.length ?? 3}</span>
      </div></header>
      <main id="main" className="check"><div className="wrap stage"><div className="main">
        <Problem error={error} />
        <Stars marks={marks.map((m) => m?.correct)} small />
        {lesson ? <span className={`tier ${lesson.tier}`}>{TIER_NAME[lesson.tier]}</span> : null}
        {q ? (
          <>
            <h1 className="q" ref={heading} tabIndex={-1}>{q.prompt}</h1>
            <p className="visually-hidden" aria-live="polite">Question {qi + 1} of {paper!.questions.length}</p>
            <div role="group" aria-label="Answers">
              {q.options.map((o, k) => {
                const state = !mark ? '' : o.key === mark.correctKey ? 'right' : o.key === mark.chosen ? 'wrong' : '';
                return (
                  <button key={o.key} type="button" className={`opt ${state}`} disabled={!!mark || busy} aria-pressed={mark?.chosen === o.key}
                    onClick={() => void answer(o.key)}>
                    <span className="k" aria-hidden="true">{'ABC'[k] ?? o.key.toUpperCase()}</span>
                    <span>{o.text}{state === 'right' ? <span className="visually-hidden"> (the right answer)</span> : state === 'wrong' ? <span className="visually-hidden"> (your answer)</span> : null}</span>
                  </button>
                );
              })}
            </div>
            <div className={`ratwrap ${open ? 'open' : ''}`} aria-live="polite">
              <div>
                {mark ? (
                  <>
                    <div className={`rat ${mark.correct ? 'right' : 'wrong'}`}><b>{mark.correct ? 'Correct' : 'Not quite'}</b>{mark.rationale.replace(/^Correct\.\s*/, '')}</div>
                    <button ref={nextBtn} className="btn" type="button" disabled={busy} onClick={() => void next()}>
                      {qi < (paper?.questions.length ?? 3) - 1 ? 'Next question' : 'See my result'}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </>
        ) : error ? null : <h1 className="q">Drawing your three questions…</h1>}
      </div>
      <aside className="aside" aria-label="How this check is going">
        <Scene title={lesson?.title ?? 'Knowledge check'} body="Two of three verifies the lesson and moves you along your path."
          chips={lesson ? [{ at: { top: 90, right: 22 }, icon: 'xp', title: `+${lesson.xp} XP`, sub: 'When verified' }] : []} />
        <div className="acard">
          <h3>Stars</h3>
          <Stars marks={marks.map((m) => m?.correct)} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>{standing}</div>
          <div className="keys">Press <kbd>A</kbd><kbd>B</kbd><kbd>C</kbd> to answer</div>
        </div>
      </aside>
      </div></main>
      {result && lesson ? <Verified result={result} lesson={lesson} retry={draw} /> : null}
    </div>
  );
}
