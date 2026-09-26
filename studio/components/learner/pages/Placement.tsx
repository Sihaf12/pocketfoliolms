'use client';
/**
 * Placement: eight scenarios, one at a time. Choosing an answer holds it
 * on screen for 400ms, then moves on by itself; "Not covered yet" in the
 * top row skips, and a skipped question becomes a lesson in the path.
 * A, B and C answer from the keyboard. Nothing is marked right or wrong
 * here: the answers are sent once, at the end, and the server places.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, call } from '@/lib/api';
import { Problem } from '../form';
import { Scene } from '../Scene';
import { AppTop, SkipLink } from '../Shell';
import { homeFor, useMe, type Tier } from '../context';

interface Question { id: string; tier: Tier; prompt: string; options: { key: string; text: string }[] }
interface Paper { attemptId: string; questions: Question[] }

const TIER_NAME: Record<Tier, string> = { learn: 'Learn', safeguard: 'Safeguard', apply: 'Apply', specialise: 'Specialise' };
const TIERS: Tier[] = ['learn', 'safeguard', 'apply', 'specialise'];
/** How long a chosen answer stays on screen before the next question. */
export const ADVANCE_MS = 400;

export function Placement() {
  const router = useRouter();
  const { me, refresh } = useMe(true);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | null>>({});
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const locked = useRef(false);

  // The paper is drawn once. Refreshing the session after submitting must
  // not ask again: the answer would be "already placed", and a redirect.
  const drawn = useRef(false);
  useEffect(() => {
    if (!me || drawn.current) return;
    drawn.current = true;
    call<Paper>('/api/v1/placement', { method: 'POST' }).then(setPaper).catch((err: unknown) => {
      if (err instanceof ApiError && (err.code === 'already_placed' || err.code === 'onboarding_required')) {
        router.replace(homeFor(me.user.lifecycle));
        return;
      }
      setError(err);
    });
  }, [me, router]);

  const finish = useCallback(async (all: Record<string, string | null>) => {
    if (!paper) return;
    setSending(true);
    try {
      await call(`/api/v1/placement/${paper.attemptId}/submission`, { method: 'POST', body: { answers: all } });
      await refresh();
      router.push('/start');
    } catch (err) {
      setError(err); setSending(false); locked.current = false;
    }
  }, [paper, refresh, router]);

  const advance = useCallback((all: Record<string, string | null>) => {
    if (!paper) return;
    if (i >= paper.questions.length - 1) { void finish(all); return; }
    setI(i + 1);
    setChosen(null);
    locked.current = false;
    // The next question slides in, and the reader starts there.
    const el = card.current;
    if (el) { el.classList.remove('slidein'); void el.offsetWidth; el.classList.add('slidein'); }
    requestAnimationFrame(() => heading.current?.focus());
  }, [paper, i, finish]);

  const answer = useCallback((key: string) => {
    if (!paper || locked.current) return;
    locked.current = true;
    const q = paper.questions[i]!;
    const all = { ...answers, [q.id]: key };
    setAnswers(all);
    setChosen(key);
    setTimeout(() => advance(all), ADVANCE_MS);
  }, [paper, i, answers, advance]);

  const skip = useCallback(() => {
    if (!paper || locked.current) return;
    locked.current = true;
    const all = { ...answers, [paper.questions[i]!.id]: null };
    setAnswers(all);
    advance(all);
  }, [paper, i, answers, advance]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input, textarea')) return;
      const k = 'abc'.indexOf(e.key.toLowerCase());
      const q = paper?.questions[i];
      if (k >= 0 && q?.options[k]) { e.preventDefault(); answer(q.options[k]!.key); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [paper, i, answer]);

  const q = paper?.questions[i];
  const total = paper?.questions.length ?? 8;
  const answeredCount = Object.values(answers).filter((a) => a !== null).length;
  const skippedCount = Object.values(answers).filter((a) => a === null).length;

  return (
    <div className="screen">
      <SkipLink />
      <AppTop nav={false} />
      <main id="main" className="flow"><div className="wrap stage"><div className="main">
        <Problem error={error} />
        {q ? (
          <>
            <div className="qhead">
              <div><span className={`tier ${q.tier}`}>{TIER_NAME[q.tier]}</span> <span className="crumb" style={{ marginLeft: 8 }}>{i + 1} of {total}</span></div>
              <button className="skip" type="button" onClick={skip} disabled={sending}>Not covered yet</button>
              <div className="qdots" aria-hidden="true">
                {paper!.questions.map((x, k) => <i key={x.id} className={k < i ? 'done' : k === i ? 'now' : ''} />)}
              </div>
            </div>
            <p className="visually-hidden" aria-live="polite">Question {i + 1} of {total}</p>
            <div className="card" ref={card}>
              <h1 className="q" ref={heading} tabIndex={-1}>{q.prompt}</h1>
              <div role="group" aria-label="Answers">
                {q.options.map((o, k) => (
                  <button key={o.key} type="button" className={`opt ${chosen === o.key ? 'sel press' : ''}`} aria-pressed={chosen === o.key}
                    disabled={sending || (chosen !== null && chosen !== o.key)} onClick={() => answer(o.key)}>
                    <span className="k" aria-hidden="true">{'ABC'[k] ?? o.key.toUpperCase()}</span><span>{o.text}</span>
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 14 }}>Skipped questions become lessons in your path. Nothing is marked wrong.</p>
            </div>
          </>
        ) : error ? null : <h1 className="q">Getting your questions ready…</h1>}
      </div>
      <aside className="aside" aria-label="Your placement so far">
        <Scene title="No wrong answers here." body="Every question you already know is a lesson you get to skip. Not sure? Skip it and it becomes part of your path." />
        <div className="acard">
          <h3>Your placement</h3>
          <div className="stones">
            {TIERS.map((t) => (
              <div className="tr" key={t}>
                <span className={`tier ${t}`}>{TIER_NAME[t]}</span>
                <span className="dots" style={{ '--c': `var(--${t})` } as React.CSSProperties}>
                  {(paper?.questions ?? []).map((x, k) => (x.tier === t ? (
                    <b key={x.id} className={k < i ? (answers[x.id] === null ? 's' : 'a') : k === i ? 'now' : ''}
                      title={k < i ? (answers[x.id] === null ? 'Skipped' : 'Answered') : undefined} />
                  ) : null))}
                </span>
              </div>
            ))}
          </div>
          <div className="note">{answeredCount} answered, {skippedCount} skipped, {total - answeredCount - skippedCount} to go.</div>
          <div className="keys">Press <kbd>A</kbd><kbd>B</kbd><kbd>C</kbd> to answer</div>
        </div>
      </aside>
      </div></main>
    </div>
  );
}
