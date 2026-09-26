/**
 * The design's illustrated asides, shown beside the main column from
 * 1024px: one illustration, the climb, with four tier checkpoints on a
 * path to the summit flag, and a few floating chips.
 */
import { Bolt, Flame, Tick } from './icons';

export function Art() {
  return (
    <svg viewBox="0 0 440 250" aria-hidden="true">
      <circle cx="338" cy="68" r="92" fill="var(--accent)" opacity=".13" /><circle cx="338" cy="68" r="46" fill="var(--accent)" opacity=".9" />
      <g fill="#fff" opacity=".55"><circle cx="60" cy="40" r="1.6" /><circle cx="120" cy="22" r="1.2" /><circle cx="182" cy="52" r="1.4" /><circle cx="410" cy="150" r="1.3" /><circle cx="26" cy="118" r="1.1" /><circle cx="262" cy="18" r="1.2" /></g>
      <path d="M0 196 L78 128 L128 160 L234 56 L306 128 L362 100 L440 146 V250 H0Z" fill="#fff" opacity=".09" />
      <path d="M234 56 L256 78 L244 80 L230 70 L214 82 L220 74Z" fill="#fff" opacity=".35" />
      <path d="M0 226 C70 196 140 222 214 196 C290 170 356 196 440 178 V250 H0Z" fill="#fff" opacity=".12" />
      <path d="M34 238 C90 232 96 214 132 206 C170 198 176 170 190 156 C204 142 214 124 224 104 C230 90 232 76 234 60" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="1 9" />
      <g stroke="#fff" strokeWidth="3"><circle cx="72" cy="228" r="11" fill="var(--learn)" /><circle cx="136" cy="204" r="11" fill="var(--safeguard)" /><circle cx="192" cy="154" r="11" fill="var(--apply)" /><circle cx="224" cy="104" r="11" fill="var(--specialise)" /></g>
      <path d="M234 60 V22" stroke="#fff" strokeWidth="3" strokeLinecap="round" /><path d="M236 23 L266 31 L236 40Z" fill="var(--accent)" />
    </svg>
  );
}

type ChipIcon = 'flame' | 'xp' | 'ok';
const ICON: Record<ChipIcon, [string, React.ReactNode]> = { flame: ['ic-flame', <Flame key="f" />], xp: ['ic-xp', <Bolt key="b" />], ok: ['ic-ok', <Tick key="t" />] };

export interface FloatChip { at: React.CSSProperties; icon: ChipIcon; title: string; sub?: string }

export function Scene({ title, body, chips = [] }: { title: string; body: string; chips?: FloatChip[] }) {
  return (
    <div className="scene">
      <div className="art"><Art /></div>
      {chips.map((c) => (
        <div className="fchip" style={c.at} key={c.title}>
          <i className={ICON[c.icon][0]}>{ICON[c.icon][1]}</i>
          <span>{c.title}{c.sub ? <small>{c.sub}</small> : null}</span>
        </div>
      ))}
      <div className="scopy"><h2>{title}</h2><p>{body}</p></div>
    </div>
  );
}
