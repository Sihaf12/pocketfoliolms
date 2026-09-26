'use client';
/**
 * The starting point: the level placement gave, and each tier's score.
 * The bars fill one after another, each number rolling up as its bar
 * grows. Under the bars, what opens next, in the server's words.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { call } from '@/lib/api';
import { Problem } from '../form';
import { MarkIcon } from '../icons';
import { AppTop, SkipLink } from '../Shell';
import { useMe, type Scores, type Tier } from '../context';

export interface PathwayTier {
  tier: Tier; unlocked: boolean; gateReason: string | null; outlook: string;
  courses: PathwayCourse[];
}
export interface PathwayCourse {
  id: string; title: string; estMinutes: number; state: string; progressPct: number;
  certificate: { serial: string; issuedAt: string } | null;
  lessons: PathwayLesson[];
}
export interface PathwayLesson {
  id: string; position: number; title: string; minutes: number; xp: number;
  state: 'done' | 'open' | 'locked'; gateReason: string | null; requires: string[];
}
export interface Pathway { level: string; baseline: Scores; nextLessonId: string | null; tiers: PathwayTier[] }

export const TIER_NAME: Record<Tier, string> = { learn: 'Learn', safeguard: 'Safeguard', apply: 'Apply', specialise: 'Specialise' };
export const TIER_BLURB: Record<Tier, string> = { learn: 'Fundamentals', safeguard: 'Risk and protection', apply: 'Practical execution', specialise: 'Advanced markets' };
export const levelName = (level: string) => level.charAt(0).toUpperCase() + level.slice(1);

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A number rolling up to its value over `ms`, easing out; at once under reduced motion. */
export function Roll({ to, ms, start }: { to: number; ms: number; start: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!start) return;
    if (reduced()) { setN(to); return; }
    let raf = 0;
    const t0 = performance.now();
    const f = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [to, ms, start]);
  return <>{n}</>;
}

/** Bars that fill in sequence: the first after a beat, then one every step. */
export function useSequence(count: number, first = 450, step = 400) {
  const [shown, setShown] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    if (!count) return;
    if (reduced()) { setShown(count); return; }
    timers.current = Array.from({ length: count }, (_, i) => setTimeout(() => setShown(i + 1), first + i * step));
    return () => timers.current.forEach(clearTimeout);
  }, [count, first, step]);
  return shown;
}

export function TierBars({ tiers, baseline, right }: { tiers: PathwayTier[]; baseline: Scores; right?: (t: PathwayTier) => React.ReactNode }) {
  const shown = useSequence(tiers.length);
  return (
    <>
      {tiers.map((t, i) => (
        <div className="tierbar" key={t.tier}>
          <div className="row">
            <span><span className={`tier ${t.tier}`}>{TIER_NAME[t.tier]}</span> <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginLeft: 6 }}>{TIER_BLURB[t.tier]}</span></span>
            {right ? right(t) : <b aria-hidden="true"><Roll to={baseline[t.tier]} ms={400} start={i < shown} /></b>}
          </div>
          <div className="bar" role="img" aria-label={`${TIER_NAME[t.tier]}: ${baseline[t.tier]} of 100`}>
            <i style={{ width: i < shown ? `${Math.min(100, baseline[t.tier])}%` : 0, background: `var(--${t.tier})` }} />
          </div>
          <small>{t.outlook}</small>
        </div>
      ))}
    </>
  );
}

function joinNames(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '';
}

export function Start() {
  useMe(true);
  const [path, setPath] = useState<Pathway | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { call<Pathway>('/api/v1/pathway').then(setPath).catch(setError); }, []);

  const open = path?.tiers.filter((t) => t.unlocked).map((t) => TIER_NAME[t.tier]) ?? [];
  return (
    <div className="screen">
      <SkipLink />
      <AppTop nav={false} />
      <main id="main" className="flow"><div className="wrap">
        <Problem error={error} />
        {path ? (
          <>
            <div className="lvl">
              <div className="em" aria-hidden="true"><MarkIcon /></div>
              <div className="crumb" style={{ marginTop: 18 }}>You are starting as</div>
              <h1 className="nm">{levelName(path.level)}</h1>
              <p>Nothing here is a pass or a fail. It decides where your path begins.</p>
            </div>
            <div className="card"><TierBars tiers={path.tiers} baseline={path.baseline} /></div>
            <div className="foot">
              <small>{joinNames(open)} open today.</small>
              <Link className="btn" href="/path">See my path</Link>
            </div>
          </>
        ) : error ? null : <h1 className="q">Working out your starting point…</h1>}
      </div></main>
    </div>
  );
}
