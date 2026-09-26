'use client';
/**
 * Progress: the level, XP and this week's learning days; each tier with
 * what opens next; certificates; the lessons verified most recently. And
 * Me: the profile placement and onboarding built, and signing out.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/api';
import { Problem } from '../form';
import { Close, MarkIcon, Tick } from '../icons';
import { AppTop, SkipLink, Tabbar } from '../Shell';
import { useAcademy, useMe, type Me } from '../context';
import { TIER_NAME, TierBars, levelName, type Pathway } from './Start';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const DAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_NAME = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function CertificateCard({ holder, course, serial, issuedAt }: { holder: string; course: string; serial: string; issuedAt: string }) {
  return (
    <div className="cert">
      <div className="cap">CERTIFICATE OF ACHIEVEMENT</div>
      <h3>{holder}</h3>
      <div style={{ fontSize: 14 }}>has completed and verified</div>
      <div className="ff" style={{ fontSize: 17, fontWeight: 600, marginTop: 6 }}>{course}</div>
      <div className="foot">
        <div><div className="small">VERIFICATION CODE</div><div className="serial">{serial}</div></div>
        <div className="small">Issued {dateFormat.format(new Date(issuedAt))}</div>
      </div>
    </div>
  );
}

function CertificateModal({ me, cert, close }: { me: Me; cert: Me['certificates'][number]; close(): void }) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [said, setSaid] = useState('');
  const [canCopy, setCanCopy] = useState(false);
  const url = typeof window === 'undefined' ? '' : `${window.location.origin}/verify/${cert.serial}`;
  useEffect(() => {
    closeBtn.current?.focus();
    setCanCopy(!!navigator.clipboard);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <div className="veil" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="cmodal" role="dialog" aria-modal="true" aria-labelledby="cert-title">
        <div className="hd"><h2 id="cert-title">Your certificate</h2><button ref={closeBtn} className="xbtn" type="button" aria-label="Close" onClick={close}><Close /></button></div>
        <CertificateCard holder={me.user.displayName} course={cert.courseTitle} serial={cert.serial} issuedAt={cert.issuedAt} />
        <label className="visually-hidden" htmlFor="verify-url">Verification address</label>
        <input id="verify-url" className="vurl" readOnly value={url} onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.currentTarget.select()} />
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 8 }}>Anyone can open that address without an account. It shows your name, the course and the date, nothing else.</p>
        <div className="actions">
          {canCopy ? (
            <button className="btn sec sm" type="button" onClick={() => void navigator.clipboard.writeText(url).then(() => setSaid('Copied.'), () => setSaid('Could not copy it. Select the address above and copy it.'))}>Copy link</button>
          ) : null}
          <a className="btn sec sm" href={`/verify/${cert.serial}`}>Open verification page</a>
        </div>
        <p className="crumb" aria-live="polite" style={{ marginTop: 8 }}>{said}</p>
      </div>
    </div>
  );
}

export function ProgressPage() {
  const { me } = useMe(true);
  const [path, setPath] = useState<Pathway | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cert, setCert] = useState<string | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => { call<Pathway>('/api/v1/pathway').then(setPath).catch(setError); }, []);
  // Arriving from the verified moment with #cert-SERIAL opens that certificate.
  useEffect(() => { const m = /^#cert-(.+)$/.exec(window.location.hash); if (m) setCert(m[1]!); }, []);

  const open = (serial: string) => { returnTo.current = document.activeElement as HTMLElement; setCert(serial); };
  const close = () => { setCert(null); history.replaceState(null, '', '/progress'); requestAnimationFrame(() => returnTo.current?.focus()); };
  const shown = me?.certificates.find((c) => c.serial === cert);

  return (
    <div className="screen">
      <SkipLink />
      <AppTop />
      <main id="main" className="pathpage"><div className="wrap stag">
        <h1>Your progress</h1>
        <Problem error={error} />
        {me ? (
          <div className="phero">
            <div className="lv">
              <i aria-hidden="true"><MarkIcon /></i>
              <div><div className="big">{me.placement ? levelName(me.placement.level) : 'Not placed yet'}</div><small>{me.stats.verifiedLessons} verified lessons, {me.stats.xp} XP</small></div>
            </div>
            <div>
              <div className="big">{me.stats.streakDays} day{me.stats.streakDays === 1 ? '' : 's'}</div>
              <small>Learning streak</small>
              <ul className="week" aria-label="Days learned this week">
                {(me.week ?? []).map((d, i) => (
                  <li key={d.date} className={d.learned ? 'on' : ''}><span aria-hidden="true">{DAY[i]}</span><span className="visually-hidden">{DAY_NAME[i]}: {d.learned ? 'learned' : 'not yet'}</span></li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {path && me ? (
          <section className="pgroup" aria-labelledby="next-title">
            <h2 id="next-title">What opens next</h2>
            <div className="card">
              <TierBars tiers={path.tiers} baseline={path.baseline} right={(t) => {
                const counts = me.tiers.find((x) => x.tier === t.tier);
                return <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{counts?.verifiedLessons ?? 0} of {counts?.totalLessons ?? 0} lessons</span>;
              }} />
            </div>
          </section>
        ) : null}
        {me ? (
          <>
            <section className="pgroup" aria-labelledby="certs-title">
              <h2 id="certs-title">Certificates</h2>
              {me.certificates.length ? me.certificates.map((c) => (
                <div className="card rowcard" key={c.serial} id={`cert-${c.serial}`}>
                  <div><b className="ff" style={{ fontSize: 15 }}>{c.courseTitle}</b><p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Certificate issued. Anyone can verify it.</p></div>
                  <button className="btn sm" type="button" onClick={() => open(c.serial)}>View certificate<span className="visually-hidden"> for {c.courseTitle}</span></button>
                </div>
              )) : (
                <div className="card"><b className="ff" style={{ fontSize: 15 }}>Your first certificate</b><p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Verify every lesson in a course to earn it.</p></div>
              )}
            </section>
            <section className="pgroup" aria-labelledby="recent-title">
              <h2 id="recent-title">Recently verified</h2>
              <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
                {me.recent.length ? (
                  <ul className="recentlist">
                    {me.recent.slice(0, 4).map((r) => (
                      <li className="recent" key={r.lessonId}>
                        <i aria-hidden="true"><Tick /></i>
                        <div style={{ flex: 1 }}><b>{r.title}</b><small>{TIER_NAME[r.tier]}, verified</small></div>
                        <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>+{r.xp} XP</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="recent">Nothing verified yet. Your first lesson takes about ten minutes.</p>}
              </div>
            </section>
          </>
        ) : null}
      </div></main>
      <Tabbar />
      {me && shown ? <CertificateModal me={me} cert={shown} close={close} /> : null}
    </div>
  );
}

const GOAL: Record<string, string> = {
  new: 'I am completely new', some_experience: 'I have traded a little', stop_losing: 'I want to stop losing money', go_deeper: 'I want to go deeper',
};

export function MePage() {
  const router = useRouter();
  const academy = useAcademy();
  const { me, forget } = useMe(true);
  async function signOut() {
    await call('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    forget();
    router.push('/');
  }
  return (
    <div className="screen">
      <SkipLink />
      <AppTop />
      <main id="main" className="pathpage"><div className="wrap stag">
        <div className="sub">Profile</div>
        <h1>{me?.user.displayName ?? 'Profile'}</h1>
        {me ? (
          <>
            <div className="card">
              <dl className="kv">
                <dt>Starting point</dt><dd>{me.placement ? levelName(me.placement.level) : 'Not placed yet'}</dd>
                <dt>Goal</dt><dd>{me.user.goal ? GOAL[me.user.goal] ?? me.user.goal : 'Not set'}</dd>
                <dt>Time per day</dt><dd>{me.user.dailyMinutes ? `${me.user.dailyMinutes} minutes` : 'Not set'}</dd>
                <dt>Academy</dt><dd>{academy.name}</dd>
                <dt>Email</dt><dd>{me.user.email}</dd>
                {me.user.ibRefCode ? <><dt>Referred by</dt><dd>{me.user.ibRefCode}</dd></> : null}
              </dl>
              <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 16 }}>Your learning record belongs to this academy only. Certificates are verifiable publicly and carry your name, the course and the date, nothing else.</p>
            </div>
            <div className="card rowcard" style={{ marginTop: 14 }}>
              <div><b className="ff" style={{ fontSize: 15 }}>Sign out</b><p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Your progress is saved.</p></div>
              <button className="btn sec sm" type="button" onClick={() => void signOut()}>Sign out</button>
            </div>
          </>
        ) : null}
      </div></main>
      <Tabbar />
    </div>
  );
}
