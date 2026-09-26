'use client';
/**
 * The two questions that shape a path, then how confident the learner
 * feels in each tier: 1 to 5, a segmented row, never a slider. The API
 * takes the rating as 0 to 100; the row's five steps map onto that.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/api';
import { Choice, Problem } from '../form';
import { Scene } from '../Scene';
import { AppTop, SkipLink } from '../Shell';
import { homeFor, useMe, type Scores, type Tier } from '../context';

const GOALS = [
  { value: 'new', label: 'I am completely new' },
  { value: 'some_experience', label: 'I have traded a little' },
  { value: 'stop_losing', label: 'I want to stop losing money' },
  { value: 'go_deeper', label: 'I want to go deeper' },
] as const;
const MINUTES = [{ value: 10, label: '10 minutes' }, { value: 20, label: '20 minutes' }, { value: 30, label: '30 minutes or more' }];
const TIERS: [Tier, string, string][] = [
  ['learn', 'Learn', 'Fundamentals'], ['safeguard', 'Safeguard', 'Risk and protection'],
  ['apply', 'Apply', 'Practical execution'], ['specialise', 'Specialise', 'Advanced markets'],
];
/** 1 to 5 on screen; 0 to 100 as the API and the 60/40 placement formula take it. */
const LEVEL = [0, 25, 50, 75, 100];
const ROW = [1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }));

type Goal = (typeof GOALS)[number]['value'];

export function Onboarding() {
  const router = useRouter();
  const { me } = useMe(true);
  const [step, setStep] = useState<1 | 2>(1);
  const [dir, setDir] = useState<'fwd' | 'bwd' | ''>('');
  const [goal, setGoal] = useState<Goal | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [conf, setConf] = useState<Record<Tier, number>>({ learn: 2, safeguard: 2, apply: 2, specialise: 2 });
  const [firstCourseMinutes, setFirstCourseMinutes] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Someone already placed has nothing to do here.
  useEffect(() => { if (me && me.user.lifecycle !== 'registered' && me.user.lifecycle !== 'onboarded') router.replace(homeFor(me.user.lifecycle)); }, [me, router]);
  useEffect(() => {
    void call<{ courses: { minutes: number }[] }>('/api/v1/catalogue').then((c) => setFirstCourseMinutes(c.courses[0]?.minutes ?? null)).catch(() => undefined);
  }, []);

  const go = (n: 1 | 2) => { setDir(n === 2 ? 'fwd' : 'bwd'); setStep(n); window.scrollTo(0, 0); };

  async function start() {
    setBusy(true); setError(null);
    const selfRating = Object.fromEntries(TIERS.map(([k]) => [k, LEVEL[conf[k] - 1]])) as Scores;
    try {
      await call('/api/v1/onboarding', { method: 'PUT', body: { selfRating, goal, dailyMinutes: minutes } });
      router.push('/placement');
    } catch (err) {
      setError(err); setBusy(false);
    }
  }

  const days = minutes && firstCourseMinutes ? Math.max(1, Math.ceil(firstCourseMinutes / minutes)) : null;

  return (
    <div className="screen">
      <SkipLink />
      <AppTop nav={false} />
      <main id="main" className="flow"><div className="wrap stage"><div className="main">
        {step === 1 ? (
          <section className={`substep ${dir}`} aria-labelledby="ob1">
            <div className="crumb">About you, 1 of 2</div>
            <h1 id="ob1">What are you here for?</h1>
            <p className="lead">Two quick questions. We only ask what changes your path.</p>
            <div className="card">
              <h2 className="h3" id="goal-q">What do you want from this?</h2>
              <Choice<Goal> labelledBy="goal-q" className="pills" itemClass="pill" options={[...GOALS]} value={goal} onChange={setGoal} />
              <h2 className="h3" id="min-q">How much time on a typical day?</h2>
              <Choice<number> labelledBy="min-q" className="pills" itemClass="pill" options={MINUTES} value={minutes} onChange={setMinutes} />
            </div>
            <div className="foot">
              <small>Then how confident you feel, then eight questions.</small>
              <button className="btn" type="button" disabled={!goal || !minutes} onClick={() => go(2)}>Next</button>
            </div>
          </section>
        ) : (
          <section className={`substep ${dir}`} aria-labelledby="ob2">
            <div className="crumb">About you, 2 of 2</div>
            <h1 id="ob2">How confident do you feel?</h1>
            <p className="lead">Your own read, 1 to 5. Guessing low is fine. The check that follows does most of the work.</p>
            <Problem error={error} />
            <div className="card">
              {TIERS.map(([k, name, blurb]) => (
                <div className="conf" key={k}>
                  <p className="row" id={`conf-${k}`} style={{ marginBottom: 8, fontSize: 14 }}>
                    <span className={`tier ${k}`}>{name}</span> <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginLeft: 6 }}>{blurb}</span>
                  </p>
                  <Choice<number> labelledBy={`conf-${k}`} className="seg" options={ROW} value={conf[k]} onChange={(v) => setConf({ ...conf, [k]: v })} />
                  <div className="hint" aria-hidden="true"><span>New to this</span><span>Very confident</span></div>
                </div>
              ))}
            </div>
            <div className="foot">
              <button className="skip" type="button" style={{ color: 'var(--ink-soft)' }} onClick={() => go(1)}>Back</button>
              <button className="btn" type="button" disabled={busy} onClick={() => void start()}>Start the placement check</button>
            </div>
          </section>
        )}
      </div>
      <aside className="aside" aria-label="Your plan">
        <Scene title="Your path is taking shape." body="Your answers here decide the order of your lessons and how long each day takes."
          chips={[{ at: { top: 20, left: 20 }, icon: 'flame', title: 'Daily streaks', sub: 'Any lesson counts' }]} />
        <div className="acard">
          <h3>Your plan so far</h3>
          <div className="kvr"><span>Goal</span><b>{GOALS.find((g) => g.value === goal)?.label ?? 'Pick one'}</b></div>
          <div className="kvr"><span>Each day</span><b>{MINUTES.find((m) => m.value === minutes)?.label ?? 'Pick one'}</b></div>
          <div className="note" style={{ marginTop: 12 }}>
            {days ? <><b>First certificate in about {days} day{days > 1 ? 's' : ''}.</b> Your first course is {firstCourseMinutes} minutes in total.</> : 'Pick a goal and a daily time to see how soon your first certificate is.'}
          </div>
        </div>
      </aside>
      </div></main>
    </div>
  );
}
