'use client';
/**
 * The academy's learners: anyone with a placement or an enrolment, the
 * team's own test accounts included. Opening a learner is recorded in
 * the academy's audit log, and the page says so.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { call } from '@/lib/api';
import { TIER_NAME, TIERS, day, moment } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Head, Loading } from '../bits';
import { Field, Problem } from '../Form';
import { Icon } from '../Icon';
import { useWorkspace } from '../Workspace';

interface Summary { id: string; email: string; displayName: string; lifecycle: string; level: string | null; joinedAt: string; lastSeenAt: string | null }
interface Page { learners: Summary[]; next: string | null }

const LEVEL = (level: string | null) => (level ? level[0]!.toUpperCase() + level.slice(1) : 'Not placed yet');

export function LearnersPage() {
  const ws = useWorkspace();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Summary[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // A short pause after typing, so each keystroke is not a search.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let live = true;
    const params = new URLSearchParams(query ? { q: query } : {});
    call<Page>(`${ws.api('/learners')}?${params}`).then((p) => {
      if (!live) return;
      setRows(p.learners); setNext(p.next); setError(null);
    }).catch((err: unknown) => { if (live) { ws.handle(err); setError(err); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function more() {
    if (!next) return;
    setBusy(true);
    try {
      const params = new URLSearchParams(query ? { q: query, cursor: next } : { cursor: next });
      const p = await call<Page>(`${ws.api('/learners')}?${params}`);
      setRows((r) => [...(r ?? []), ...p.learners]);
      setNext(p.next);
    } catch (err) {
      ws.handle(err);
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head title="Learners" lead="Everyone who has taken a placement or started a course, newest first. Your team's own test accounts are here too." />
      <div className="stack">
        <Field label="Find a learner" hint="By name or email.">
          {(p) => <input {...p} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} />}
        </Field>
        <Problem error={error} />
        {rows === null ? <Loading /> : rows.length ? (
          <>
            <ul className="list" aria-live="polite">
              {rows.map((l) => (
                <li key={l.id}>
                  <Link className="item" href={ws.href(`/learners/${l.id}`)}>
                    <span className="grow">
                      <span className="title">{l.displayName}</span>
                      <span className="soft small">{l.email}. Joined {day(l.joinedAt)}.</span>
                    </span>
                    <span className="chip plain">{LEVEL(l.level)}</span>
                    <Icon name="next" />
                  </Link>
                </li>
              ))}
            </ul>
            {next ? <button type="button" className="btn" disabled={busy} onClick={() => void more()}>Show more learners</button> : null}
          </>
        ) : (
          <div className="card empty"><p>{query ? `Nobody matches “${query}”.` : 'No learners yet. They appear here once they take a placement or start a course.'}</p></div>
        )}
      </div>
    </>
  );
}

interface Detail {
  learner: Summary;
  placement: { level: string; baseline: Record<string, number>; selfRating: Record<string, number>; placedAt: string } | null;
  courses: { courseId: string; title: string; state: string; progressPct: number; startedAt: string; completedAt: string | null }[];
  certificates: { serial: string; courseTitle: string; issuedAt: string; revoked: boolean }[];
  lessonsVerified: number;
}
interface Attempt { id: string; kind: string; courseTitle: string | null; lessonTitle: string | null; correct: number | null; total: number | null; passed: boolean | null; startedAt: string; submittedAt: string | null }

export function LearnerPage({ learnerId }: { learnerId: string }) {
  const ws = useWorkspace();
  const detail = useLoad<Detail>(ws.api(`/learners/${learnerId}`));
  const attempts = useLoad<{ attempts: Attempt[] }>(ws.api(`/learners/${learnerId}/attempts`));
  const back = { href: ws.href('/learners'), label: 'Learners' };
  if (!detail.data) return <><Head title="Learner" back={back} /><Loading error={detail.error} /></>;
  const { learner, placement, courses, certificates, lessonsVerified } = detail.data;

  return (
    <>
      <Head title={learner.displayName} back={back}
        lead={`${learner.email}. Joined ${day(learner.joinedAt)}${learner.lastSeenAt ? `, last seen ${day(learner.lastSeenAt)}` : ''}. Opening this record is noted in the academy's audit log.`} />

      <section aria-labelledby="placement">
        <h2 id="placement">Placement</h2>
        {placement ? (
          <div className="card stack">
            <p>Placed as <b>{LEVEL(placement.level)}</b> on {day(placement.placedAt)}. {lessonsVerified} lessons verified since.</p>
            <ul className="tiers">
              {TIERS.map((t) => (
                <li key={t}>
                  <span className="tier-name">{TIER_NAME[t]}</span>
                  <span className="meter">
                    <span className={`bar ${t}`}><i style={{ width: `${Math.min(100, placement.baseline[t] ?? 0)}%` }} /></span>
                    <span className="num">{placement.baseline[t] ?? 0}</span>
                  </span>
                  <span className="soft small">Placement score {placement.baseline[t] ?? 0}. They rated themselves {placement.selfRating[t] ?? 0}.</span>
                </li>
              ))}
            </ul>
          </div>
        ) : <div className="card"><p>Not placed yet. They have started a course without taking the placement.</p></div>}
      </section>

      <section aria-labelledby="courses">
        <h2 id="courses">Courses</h2>
        {courses.length ? (
          <ul className="list">
            {courses.map((c) => (
              <li className="item" key={c.courseId}>
                <span className="grow">
                  <span className="title">{c.title}</span>
                  <span className="soft small">Started {day(c.startedAt)}{c.completedAt ? `, completed ${day(c.completedAt)}` : ''}.</span>
                  <span className="meter"><span className="bar"><i style={{ width: `${c.progressPct}%` }} /></span><span className="num">{c.progressPct}%</span></span>
                </span>
              </li>
            ))}
          </ul>
        ) : <div className="card"><p>No courses started.</p></div>}
      </section>

      <section aria-labelledby="certificates">
        <h2 id="certificates">Certificates</h2>
        {certificates.length ? (
          <ul className="list">
            {certificates.map((c) => (
              <li className="item" key={c.serial}>
                <span className="grow"><span className="title">{c.courseTitle}</span><span className="mono small">{c.serial}</span></span>
                <span className="soft small">{day(c.issuedAt)}</span>
                {c.revoked ? <span className="chip danger">Revoked</span> : <span className="chip success">Valid</span>}
              </li>
            ))}
          </ul>
        ) : <div className="card"><p>No certificates yet.</p></div>}
      </section>

      <section aria-labelledby="attempts">
        <h2 id="attempts">Attempts</h2>
        {!attempts.data ? <Loading error={attempts.error} /> : attempts.data.attempts.length ? (
          <div className="table-wrap" role="region" aria-label="Attempts, newest first" tabIndex={0}>
            <table>
              <caption className="visually-hidden">Placement and knowledge-check attempts, newest first</caption>
              <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Score</th><th scope="col">Result</th></tr></thead>
              <tbody>
                {attempts.data.attempts.map((a) => (
                  <tr key={a.id}>
                    <td>{moment(a.submittedAt ?? a.startedAt)}</td>
                    <td>{a.kind === 'placement' ? 'Placement' : `Check: ${a.lessonTitle ?? a.courseTitle ?? 'a lesson'}`}</td>
                    <td className="num">{a.total ? `${a.correct ?? 0} of ${a.total}` : 'Not finished'}</td>
                    <td>{a.submittedAt === null ? <span className="chip plain">Open</span>
                      : a.kind === 'placement' ? <span className="chip brand">Placed</span>
                        : a.passed ? <span className="chip success">Passed</span> : <span className="chip caution">Not yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="card"><p>No attempts yet.</p></div>}
      </section>
    </>
  );
}
