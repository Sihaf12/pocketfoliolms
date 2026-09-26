'use client';
/**
 * The path. The next lesson is one tap away at the top; below it, the map.
 * Choosing a lesson opens what it is and whether it can be started: a
 * popover beside it on wider screens, a bottom sheet on phones. A locked
 * lesson says exactly what opens it, in the server's words.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { call } from '@/lib/api';
import { Problem } from '../form';
import { Chevron, Play } from '../icons';
import { PathMap, layout, type MapNode } from '../PathMap';
import { AppTop, SkipLink, Tabbar } from '../Shell';
import { useMe, type Tier } from '../context';
import { TIER_NAME, levelName, type Pathway, type PathwayLesson } from './Start';

interface Lesson extends PathwayLesson { tier: Tier }

function lessonsOf(path: Pathway): Lesson[] {
  return path.tiers.flatMap((t) => t.courses.flatMap((c) => c.lessons.map((l) => ({ ...l, tier: t.tier }))));
}

/** The words for one lesson: its tier, its title, how long, and what to do or what stands in the way. */
function LessonDetail({ lesson, close, compact }: { lesson: Lesson; close(): void; compact: boolean }) {
  const first = useRef<HTMLElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  return (
    <>
      <span className="t">{TIER_NAME[lesson.tier]}</span>
      <b className="title" id={`detail-${lesson.id}`}>{lesson.title}</b>
      <small>{lesson.minutes} minutes. Two of three to verify. {lesson.xp} XP.</small>
      {lesson.state === 'locked' ? (
        <>
          <div className="lock">{lesson.gateReason}</div>
          <button ref={first as React.Ref<HTMLButtonElement>} className={`btn sec ${compact ? 'sm' : ''}`} type="button" onClick={close}>Close</button>
        </>
      ) : lesson.state === 'done' ? (
        <>
          <div className="lock done">Verified. Retake anytime; it will not count twice.</div>
          <Link ref={first as React.Ref<HTMLAnchorElement>} className={`btn sec ${compact ? 'sm' : ''}`} href={`/learn/${lesson.id}`}>Read it again</Link>
          <button className={`btn sec ${compact ? 'sm' : ''}`} type="button" onClick={close}>Close</button>
        </>
      ) : (
        <Link ref={first as React.Ref<HTMLAnchorElement>} className={`btn ${compact ? 'sm' : ''}`} href={`/learn/${lesson.id}`}>Start lesson</Link>
      )}
    </>
  );
}

export function PathPage() {
  const { me } = useMe(true);
  const [path, setPath] = useState<Pathway | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<{ lesson: Lesson; x: number; y: number; sheet: boolean } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => { call<Pathway>('/api/v1/pathway').then(setPath).catch(setError); }, []);

  const lessons = path ? lessonsOf(path) : [];
  const nodes: MapNode[] = lessons.map((l) => ({ id: l.id, title: l.title, tier: l.tier, state: l.state, requires: l.requires }));
  const next = lessons.find((l) => l.id === path?.nextLessonId) ?? null;
  const done = lessons.filter((l) => l.state === 'done').length;

  // On a phone the map is wider than the screen: start it with the next lesson in view.
  useEffect(() => {
    if (!path || !next || !scroller.current || window.innerWidth >= 768) return;
    const svg = scroller.current.querySelector('svg');
    const placed = layout(nodes).placed.find((p) => p.id === next.id);
    if (!svg || !placed) return;
    const scale = svg.getBoundingClientRect().width / layout(nodes).width;
    scroller.current.scrollLeft = Math.max(0, placed.x * scale - scroller.current.clientWidth / 2);
    // Once the path has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const close = useCallback(() => {
    setOpen(null);
    requestAnimationFrame(() => returnTo.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      // The sheet is modal: Tab goes round inside it.
      const sheet = document.querySelector<HTMLElement>('.sheet');
      if (e.key === 'Tab' && sheet) {
        const items = [...sheet.querySelectorAll<HTMLElement>('a[href], button')];
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const select = (id: string, anchor: DOMRect) => {
    const lesson = lessons.find((l) => l.id === id);
    const cardBox = card.current?.getBoundingClientRect();
    if (!lesson || !cardBox) return;
    returnTo.current = document.activeElement as HTMLElement;
    const sheet = window.innerWidth < 768;
    const x = Math.max(8, Math.min(cardBox.width - 244, anchor.left - cardBox.left + anchor.width / 2 - 118));
    setOpen({ lesson, x, y: anchor.bottom - cardBox.top + 8, sheet });
  };

  return (
    <div className="screen">
      <SkipLink />
      <AppTop />
      <main id="main" className="pathpage"><div className="wrap stag">
        <div className="sub">{path ? `${levelName(path.level)}, ${done} of ${lessons.length} verified` : me ? me.user.displayName : ''}</div>
        <h1>Your path</h1>
        <Problem error={error} />
        {next ? (
          <Link className="cont" href={`/learn/${next.id}`} style={{ '--c': `var(--${next.tier})` } as React.CSSProperties}>
            <i><Play /></i>
            <span className="t"><small>Continue</small><b>{next.title}</b><small>{TIER_NAME[next.tier]}, {next.minutes} minutes</small></span>
            <Chevron />
          </Link>
        ) : path ? <p className="card" style={{ marginBottom: 16 }}>Everything open to you is verified. New lessons open as your scores rise.</p> : null}
        {path ? (
          <div className="mapcard" ref={card} onClick={(e) => { if (open && !open.sheet && e.target === e.currentTarget) close(); }}>
            <div className="mapscroll" ref={scroller}>
              <PathMap nodes={nodes} onSelect={select} label="Your path. Choose a lesson to see what it is and what opens it." />
            </div>
            <div className="tiers" aria-hidden="true">{(['learn', 'safeguard', 'apply', 'specialise'] as Tier[]).map((t) => <span key={t} className={`tier ${t}`}>{TIER_NAME[t]}</span>)}</div>
            {open && !open.sheet ? (
              <div className="pop" role="dialog" aria-labelledby={`detail-${open.lesson.id}`} style={{ left: open.x, top: open.y }}>
                <LessonDetail lesson={open.lesson} close={close} compact />
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="pathhint">Choose any lesson. Locked ones say exactly what opens them.</p>
      </div></main>
      {open?.sheet ? (
        <>
          <div className="sheetveil" onClick={close} aria-hidden="true" />
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={`detail-${open.lesson.id}`}>
            <div className="grab" aria-hidden="true" />
            <LessonDetail lesson={open.lesson} close={close} compact={false} />
          </div>
        </>
      ) : null}
      <Tabbar />
    </div>
  );
}
