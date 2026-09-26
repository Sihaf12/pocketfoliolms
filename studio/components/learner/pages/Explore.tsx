'use client';
/**
 * Every course this academy offers, by tier: what each is, how far the
 * learner is into it, and, for a tier not open yet, what opens it.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { call } from '@/lib/api';
import { Problem } from '../form';
import { AppTop, SkipLink, Tabbar } from '../Shell';
import { useMe } from '../context';
import { TIER_BLURB, TIER_NAME, type Pathway } from './Start';

export function Explore() {
  useMe(true);
  const [path, setPath] = useState<Pathway | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { call<Pathway>('/api/v1/pathway').then(setPath).catch(setError); }, []);

  return (
    <div className="screen">
      <SkipLink />
      <AppTop />
      <main id="main" className="pathpage"><div className="wrap stag">
        <div className="sub">Every course here</div>
        <h1>Explore</h1>
        <Problem error={error} />
        {path?.tiers.map((t) => (
          <section className="tiergroup" key={t.tier} aria-labelledby={`tier-${t.tier}`}>
            <h2 id={`tier-${t.tier}`}><span className={`tier ${t.tier}`}>{TIER_NAME[t.tier]}</span>{TIER_BLURB[t.tier]}{t.unlocked ? null : <span className="gate">{t.gateReason}</span>}</h2>
            {t.courses.length ? (
              <ul className="courselist">
                {t.courses.map((c) => {
                  const done = c.lessons.filter((l) => l.state === 'done').length;
                  const next = c.lessons.find((l) => l.state === 'open');
                  return (
                    <li className="course" key={c.id} style={{ '--c': `var(--${t.tier})` } as React.CSSProperties}>
                      <h3>{c.title}</h3>
                      <p>{done} of {c.lessons.length} lessons verified{c.certificate ? '. Certificate issued.' : '.'}</p>
                      <div className="bar" role="img" aria-label={`${c.progressPct}% complete`}><i style={{ width: `${c.progressPct}%`, background: `var(--${t.tier})` }} /></div>
                      {next ? <Link className="linkbtn" href={`/learn/${next.id}`}>Continue with {next.title}</Link> : null}
                    </li>
                  );
                })}
              </ul>
            ) : <p className="crumb">No courses in this tier yet.</p>}
          </section>
        ))}
      </div></main>
      <Tabbar />
    </div>
  );
}
