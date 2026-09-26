'use client';
/**
 * The path: the product's one loud element. Lessons are laid out by how
 * many steps of prerequisites stand before them, left to right; each
 * column is stacked around the middle. Done lessons are filled in their
 * tier colour with a tick, the open one has a ring and a play glyph, and
 * locked ones are dashed with a padlock.
 *
 * It draws itself once when it appears: edges, then nodes, the next
 * lesson settling last, all within 900ms. Reduced motion shows it drawn.
 */
import { useEffect, useRef, useState } from 'react';
import type { Tier } from './context';

export type NodeState = 'done' | 'open' | 'locked';

export interface MapNode {
  id: string;
  title: string;
  tier: Tier;
  state: NodeState;
  requires: string[];
}

interface Placed extends MapNode { x: number; y: number; lines: string[] }

const TIER_ORDER: Tier[] = ['learn', 'safeguard', 'apply', 'specialise'];
const COL = 90;
const HEIGHT = 372;
const MID = 176;

/** Up to two lines of about sixteen characters, broken between words. */
function wrap(title: string): string[] {
  const words = title.split(' ');
  const lines: string[] = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1]!;
    if (cur && (cur + ' ' + w).length > 16 && lines.length < 2) lines.push(w);
    else lines[lines.length - 1] = cur ? `${cur} ${w}` : w;
  }
  return lines;
}

export function layout(nodes: MapNode[]): { width: number; height: number; placed: Placed[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (n: MapNode): number => {
    const known = depth.get(n.id);
    if (known !== undefined) return known;
    if (visiting.has(n.id)) return 0;
    visiting.add(n.id);
    const reqs = n.requires.map((r) => byId.get(r)).filter((r): r is MapNode => !!r);
    const d = reqs.length ? 1 + Math.max(...reqs.map(depthOf)) : 0;
    visiting.delete(n.id);
    depth.set(n.id, d);
    return d;
  };
  nodes.forEach(depthOf);
  const columns = new Map<number, MapNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.id)!;
    columns.set(d, [...(columns.get(d) ?? []), n]);
  }
  const maxDepth = Math.max(0, ...columns.keys());
  const placed: Placed[] = [];
  const yOf = new Map<string, number>();
  // Left to right, each column ordered by where its lessons' prerequisites
  // sit, so edges run across rather than over each other; tier breaks ties.
  for (let d = 0; d <= maxDepth; d++) {
    const col = columns.get(d) ?? [];
    const pull = (n: MapNode) => {
      const ys = n.requires.map((r) => yOf.get(r)).filter((y): y is number => y !== undefined);
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : MID;
    };
    col.sort((a, b) => pull(a) - pull(b) || TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
    const gap = col.length > 1 ? Math.min(172, 240 / (col.length - 1)) : 0;
    col.forEach((n, i) => {
      const y = MID + (i - (col.length - 1) / 2) * gap;
      yOf.set(n.id, y);
      placed.push({ ...n, x: 70 + d * COL, y, lines: wrap(n.title) });
    });
  }
  return { width: Math.max(520, 140 + maxDepth * COL), height: HEIGHT, placed };
}

const STATE_WORDS: Record<NodeState, string> = { done: 'verified', open: 'open, next', locked: 'locked' };

export function PathMap({ nodes, onSelect, label = 'Your path', animate = true }: {
  nodes: MapNode[];
  /** Makes each lesson a button; without it the map is an illustration. */
  onSelect?(id: string, anchor: DOMRect): void;
  label?: string;
  animate?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(!animate);
  // Drawn once, on the frame after it appears, so the animation runs.
  useEffect(() => {
    if (!animate) return;
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, [animate]);

  const { width, height, placed } = layout(nodes);
  const at = new Map(placed.map((p) => [p.id, p]));
  const edges = placed.flatMap((n) => n.requires.map((r) => at.get(r)).filter((a): a is Placed => !!a).map((a) => [a, n] as const));
  // Timing: every edge has drawn by 800ms; the open lesson lands last, by 900ms.
  const edgeStep = Math.min(0.06, 0.3 / Math.max(1, edges.length));
  const nodeStep = Math.min(0.05, 0.4 / Math.max(1, placed.length));
  const c = (t: Tier) => `var(--${t})`;

  const select = (n: Placed, target: Element) => onSelect?.(n.id, target.getBoundingClientRect());

  return (
    <div ref={box} className={drawn ? 'drawn' : ''}>
      <svg className="pathsvg" viewBox={`0 0 ${width} ${height}`} role={onSelect ? 'group' : 'img'} aria-label={label}
        style={{ minWidth: width > 520 ? `${width}px` : undefined }}>
        {edges.map(([a, b], i) => {
          const mx = (a.x + b.x) / 2;
          const lit = a.state === 'done' && b.state !== 'locked';
          return (
            <path key={`${a.id}-${b.id}`} className={`edge ${lit ? '' : 'dashed'}`} style={{ animationDelay: `${lit ? 0.05 + i * edgeStep : 0.35}s` }}
              d={`M${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`} fill="none"
              stroke={lit ? c(b.tier) : 'var(--faint)'} strokeOpacity={lit ? 1 : 0.85} strokeWidth={lit ? 3 : 2} strokeLinecap="round" />
          );
        })}
        {placed.map((n, k) => {
          const delay = n.state === 'open' ? 0.6 : 0.1 + k * nodeStep;
          const dim = n.state === 'locked' ? 0.55 : 1;
          const interactive = !!onSelect;
          return (
            <g key={n.id}>
              <g className={`node ${n.state}`} data-id={n.id} style={{ animationDelay: `${delay}s` }} opacity={dim}
                role={interactive ? 'button' : undefined} tabIndex={interactive ? 0 : undefined}
                aria-label={interactive ? `${n.title}, ${STATE_WORDS[n.state]}` : undefined}
                onClick={interactive ? (e) => select(n, e.currentTarget) : undefined}
                onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(n, e.currentTarget); } } : undefined}>
                <circle className="hit" cx={n.x} cy={n.y} r={28} fill="transparent" />
                {n.state === 'done' ? (
                  <>
                    <circle cx={n.x} cy={n.y} r={24} fill={c(n.tier)} />
                    <path d={`M${n.x - 10} ${n.y}l7 7 13-13`} fill="none" stroke="var(--on-status)" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                  </>
                ) : n.state === 'open' ? (
                  <>
                    <circle className="ring" cx={n.x} cy={n.y} r={24} fill="none" stroke={c(n.tier)} strokeWidth={2} />
                    <circle cx={n.x} cy={n.y} r={24} fill="var(--raised)" stroke={c(n.tier)} strokeWidth={3.5} />
                    <path d={`M${n.x - 4} ${n.y - 8}l11 8-11 8z`} fill={c(n.tier)} />
                  </>
                ) : (
                  <>
                    <circle cx={n.x} cy={n.y} r={24} fill="var(--surface)" stroke={c(n.tier)} strokeWidth={2} strokeDasharray="5 5" />
                    <rect x={n.x - 8} y={n.y - 2} width={16} height={12} rx={2.5} fill="none" stroke={c(n.tier)} strokeWidth={2} />
                    <path d={`M${n.x - 5} ${n.y - 2}v-3a5 5 0 0110 0v3`} fill="none" stroke={c(n.tier)} strokeWidth={2} />
                  </>
                )}
              </g>
              <text className="label" style={{ animationDelay: `${delay + 0.15}s` }} x={n.x} y={n.y + 44} textAnchor="middle"
                fontFamily="var(--font-display)" fontSize={11.5} fontWeight={600} fill="var(--ink)" aria-hidden="true">
                {n.lines.map((line, i) => <tspan key={i} x={n.x} dy={i === 0 ? 0 : 14}>{line}</tspan>)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
