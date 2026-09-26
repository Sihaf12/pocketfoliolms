'use client';
/** Chips, headers and other small pieces every screen shares. */
import Link from 'next/link';
import { STATE, TIER_NAME, type ReviewState, type Tier } from '@/lib/format';
import { Icon } from './Icon';
import { Problem } from './Form';

export function StateChip({ state }: { state: ReviewState | null | undefined }) {
  if (!state) return null;
  const s = STATE[state];
  return <span className={`chip ${s.tone}`}>{s.label}</span>;
}

export function TierChip({ tier }: { tier: Tier }) {
  return <span className={`chip ${tier}`}>{TIER_NAME[tier]}</span>;
}

export function Head({ title, lead, back, children }: {
  title: string;
  lead?: React.ReactNode;
  back?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <div className="head">
      <div>
        {back ? <Link className="back" href={back.href}><Icon name="back" />{back.label}</Link> : null}
        <h1>{title}</h1>
        {lead ? <p>{lead}</p> : null}
      </div>
      {children ? <div className="row">{children}</div> : null}
    </div>
  );
}

/** While a page's first read is in flight, or when it failed. */
export function Loading({ error }: { error?: unknown }) {
  if (error) return <Problem error={error} />;
  return <p className="soft" aria-busy="true">Loading…</p>;
}
