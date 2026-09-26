'use client';
/**
 * A lesson: Read, and Try it where the lesson has the leverage simulator.
 * The text goes through packages/shared/markdown.ts, the same code the
 * studio's preview and the API's checks use. In the simulator, a move
 * that erases the margin turns the whole page red; a critical one, amber.
 */
import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { inline, parseLesson } from '../../../../packages/shared/markdown';
import { ApiError, call } from '@/lib/api';
import { Problem } from '../form';
import { AppTop, SkipLink, Tabbar } from '../Shell';
import { useMe, type Tier } from '../context';
import { TIER_NAME, type Pathway } from './Start';

export interface LessonData {
  id: string; courseId: string; courseTitle: string; tier: Tier; position: number; title: string; bodyMd: string;
  videoAsset: string | null; transcript: { at: string; text: string }[] | null; durationSecs: number; xp: number;
  experience: string | null; authorName: string; reviewerName: string; reviewedAt: string | null; nextLessonId: string | null;
}

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function termsIn(md: string): [string, string][] {
  const found = new Map<string, string>();
  for (const m of md.matchAll(/\[\[([^\]|]+)\|([^\]]+)\]\]/g)) found.set(m[1]!, m[2]!);
  return [...found];
}

type Zone = 'ok' | 'critical' | 'dead';

/** The arithmetic the lesson describes, live: leverage times the move, against the margin. */
export function simulate(leverage: number, move: number): { lost: number; toZero: number; zone: Zone } {
  const lost = Math.min(100, leverage * move);
  return { lost, toZero: 100 / leverage, zone: lost >= 100 ? 'dead' : lost < 50 ? 'ok' : 'critical' };
}

function Simulator() {
  const [leverage, setLeverage] = useState(5);
  const [move, setMove] = useState(5);
  const lvId = useId();
  const mvId = useId();
  const { lost, toZero, zone } = simulate(leverage, move);

  // The red zone reaches past the card: the page itself changes colour.
  useEffect(() => {
    document.documentElement.dataset.zone = zone;
    return () => { delete document.documentElement.dataset.zone; };
  }, [zone]);

  const verdict = zone === 'dead'
    ? `At ${leverage}x, a ${move}% move erases your margin entirely. The position is closed for you.`
    : zone === 'ok'
      ? `At ${leverage}x you lose ${Math.round(lost)}% of your margin on a ${move}% move. A ${toZero.toFixed(1)}% move takes you to zero.`
      : `At ${leverage}x you are down ${Math.round(lost)}% of margin. Most venues would be issuing a margin call before this point.`;

  return (
    <div className="sim" data-state={zone}>
      <h2 className="ff" style={{ fontSize: 18, fontWeight: 600 }}>What a move does to you</h2>
      <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginTop: 4 }}>Move the sliders. This is the arithmetic the lesson describes, live.</p>
      <div className="srowv"><label htmlFor={lvId}>Leverage</label><b aria-hidden="true">{leverage}x</b></div>
      <input id={lvId} className="slider" type="range" min={1} max={25} value={leverage} aria-valuetext={`${leverage} times`} onChange={(e) => setLeverage(Number(e.target.value))} />
      <div className="srowv"><label htmlFor={mvId}>Adverse move</label><b aria-hidden="true">{move}%</b></div>
      <input id={mvId} className="slider" type="range" min={1} max={30} value={move} aria-valuetext={`${move} per cent`} onChange={(e) => setMove(Number(e.target.value))} />
      <div className="simout">
        <div><b>{Math.round(lost)}%</b><span>Of margin lost</span></div>
        <div><b>{toZero.toFixed(1)}%</b><span>Move to zero</span></div>
        <div><b>{zone === 'dead' ? 'Liquidated' : zone === 'ok' ? 'Survivable' : 'Critical'}</b><span>Verdict</span></div>
      </div>
      <p className={`verdict ${zone}`} aria-live="polite">{verdict}</p>
    </div>
  );
}

export function LessonPage() {
  const { id } = useParams<{ id: string }>();
  useMe(true);
  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<'read' | 'do' | 'watch'>('read');

  useEffect(() => {
    call<LessonData>(`/api/v1/lessons/${id}`).then(setLesson).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 403) setLocked(err.message);
      else setError(err);
    });
    call<Pathway>('/api/v1/pathway').then((p) => {
      const course = p.tiers.flatMap((t) => t.courses).find((c) => c.lessons.some((l) => l.id === id));
      setCount(course?.lessons.length ?? null);
    }).catch(() => undefined);
  }, [id]);

  const tabs: { key: 'read' | 'do' | 'watch'; label: string }[] = [
    { key: 'read', label: 'Read' },
    ...(lesson?.experience === 'leverage_simulator' ? [{ key: 'do' as const, label: 'Try it' }] : []),
    ...(lesson?.videoAsset ? [{ key: 'watch' as const, label: 'Watch' }] : []),
  ];
  const doc = lesson ? parseLesson(lesson.bodyMd) : null;
  const terms = lesson ? termsIn(lesson.bodyMd) : [];
  const minutes = lesson ? Math.max(1, Math.round(lesson.durationSecs / 60)) : 0;

  return (
    <div className="screen">
      <SkipLink />
      <AppTop />
      <main id="main" className="lesson"><div className="wrap stag">
        <Link className="back" href="/path">← Your path</Link>
        <Problem error={error} />
        {locked ? (
          <>
            <h1>This lesson is locked</h1>
            <p className="locked-note">{locked}</p>
            <Link className="btn" href="/path">See my path</Link>
          </>
        ) : lesson && doc ? (
          <>
            <span className={`tier ${lesson.tier}`}>{TIER_NAME[lesson.tier]}</span>
            <h1>{lesson.title}</h1>
            <p className="meta">
              Lesson {lesson.position}{count ? ` of ${count}` : ''} in {lesson.courseTitle}. {minutes} minutes. Two of three to verify.
              {' '}Written by {lesson.authorName}. {lesson.reviewedAt ? `Reviewed by ${lesson.reviewerName}, ${dateFormat.format(new Date(lesson.reviewedAt))}.` : lesson.reviewerName}
            </p>
            {tabs.length > 1 ? (
              <div className="ltabs" role="tablist" aria-label="Ways into this lesson">
                {tabs.map((t) => (
                  <button key={t.key} type="button" role="tab" id={`tab-${t.key}`} aria-controls={`panel-${t.key}`} aria-selected={tab === t.key}
                    tabIndex={tab === t.key ? 0 : -1} onClick={() => setTab(t.key)}
                    onKeyDown={(e) => {
                      const i = tabs.findIndex((x) => x.key === tab);
                      const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
                      if (next) { e.preventDefault(); setTab(next.key); document.getElementById(`tab-${next.key}`)?.focus(); }
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div id={`panel-${tab}`} role={tabs.length > 1 ? 'tabpanel' : undefined} aria-labelledby={tabs.length > 1 ? `tab-${tab}` : undefined}>
              {tab === 'read' ? (
                <div className="rd">
                  {doc.steps.map((s, i) => (
                    <div key={i}><h2>{s.h}</h2><p dangerouslySetInnerHTML={{ __html: inline(s.p) }} /></div>
                  ))}
                  {doc.callout ? <div className="callout"><b>{doc.callout.h}</b><span dangerouslySetInnerHTML={{ __html: inline(doc.callout.p) }} /></div> : null}
                  {terms.length ? (
                    <dl className="terms">{terms.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl>
                  ) : null}
                </div>
              ) : tab === 'do' ? <Simulator /> : (
                <div>
                  <div className="video">Video: {lesson.videoAsset}</div>
                  {lesson.transcript?.length ? (
                    <div className="transcript">{lesson.transcript.map((t, i) => <p key={i}><b>{t.at}</b>{t.text}</p>)}</div>
                  ) : null}
                </div>
              )}
            </div>
            <div className="foot">
              <small>{tabs.length > 1 ? 'Read it through, try it, then check your understanding.' : 'Read it through, then check your understanding.'}</small>
              <Link className="btn" href={`/learn/${lesson.id}/check`}>Check my understanding</Link>
            </div>
          </>
        ) : error ? null : <h1>Opening the lesson…</h1>}
      </div></main>
      <Tabbar />
    </div>
  );
}
