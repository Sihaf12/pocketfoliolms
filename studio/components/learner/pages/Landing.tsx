'use client';
/**
 * The landing: what the academy is for, in its own courses. Its hero is
 * the path, drawing itself once: an example learner three lessons in,
 * made from this academy's own lessons.
 */
import Link from 'next/link';
import { PathMap, type MapNode } from '../PathMap';
import { Footer, LandingNav, SkipLink } from '../Shell';
import { useAcademy, useMe, type Tier } from '../context';

export interface CatalogueCourse {
  id: string; title: string; tier: Tier; summary: string; lessons: number; minutes: number; requirement: string | null; lessonTitles: string[];
}

const TIER_NAME: Record<Tier, string> = { learn: 'Learn', safeguard: 'Safeguard', apply: 'Apply', specialise: 'Specialise' };
const EXAMPLE_PER_COURSE = [3, 2, 3, 1];

/** An example learner's path: the first course done, the next lesson open, the rest ahead. */
function examplePath(courses: CatalogueCourse[]): MapNode[] {
  const nodes: MapNode[] = [];
  courses.slice(0, 4).forEach((course, c) => {
    const titles = course.lessonTitles.slice(0, EXAMPLE_PER_COURSE[c] ?? 1);
    titles.forEach((title, i) => {
      const id = `${c}-${i}`;
      const requires = i > 0 ? [`${c}-${i - 1}`] : c > 0 ? [`0-${Math.min(c - 1, (courses[0]?.lessonTitles.length ?? 1) - 1)}`] : [];
      const state = c === 0 ? 'done' : c === 1 && i === 0 ? 'open' : 'locked';
      nodes.push({ id, title, tier: course.tier, state, requires });
    });
  });
  return nodes;
}

export function Landing({ courses }: { courses: CatalogueCourse[] }) {
  const academy = useAcademy();
  const { me } = useMe(false);
  const example = examplePath(courses);
  const questions = 8;

  return (
    <div className="screen">
      <SkipLink />
      <LandingNav signedIn={!!me} />
      <main id="main">
        <section className="hero" aria-labelledby="hero-title"><div className="wrap">
          <div>
            <h1 id="hero-title">Learn to trade the way you&apos;d want your money managed. Carefully.</h1>
            <p>We find out what you already know, teach only what you need next, and give you a certificate anyone can check. Progress here is earned. Nothing is unlocked by depositing.</p>
            <div className="cta">
              {me ? <Link className="btn" href="/path">Go to your path</Link> : <Link className="btn" href="/signup">Start your placement</Link>}
              <span>{questions} questions. About three minutes. Skip any.</span>
            </div>
          </div>
          {example.length ? (
            <div className="pathcard">
              <div className="hd"><b>Your path</b><span>An example, three lessons in</span></div>
              <PathMap nodes={example} label={`An example path through ${academy.name}'s lessons`} />
              <div className="tiers" aria-hidden="true">{(['learn', 'safeguard', 'apply', 'specialise'] as Tier[]).map((t) => <span key={t} className={`tier ${t}`}>{TIER_NAME[t]}</span>)}</div>
            </div>
          ) : null}
        </div></section>

        <section className="sec" id="how" aria-labelledby="how-title"><div className="wrap">
          <h2 id="how-title">Three steps, and none of them is a sales call</h2>
          <ol className="steps">
            <li className="step"><div className="n" aria-hidden="true">1</div><h3>Placement</h3><p>Eight scenarios. Skip any. It decides what you get to skip, not whether you pass.</p></li>
            <li className="step"><div className="n" aria-hidden="true">2</div><h3>Your path</h3><p>Lessons of six to twelve minutes, in an order that says why each one is next. Locked steps tell you exactly what opens them.</p></li>
            <li className="step"><div className="n" aria-hidden="true">3</div><h3>Verified</h3><p>Two of three on a check and the lesson counts. Finish a course and a certificate is issued, with a code anyone can verify.</p></li>
          </ol>
        </div></section>

        {courses.length ? (
          <section className="sec" id="courses" style={{ paddingTop: 0 }} aria-labelledby="courses-title"><div className="wrap">
            <h2 id="courses-title">{courses.length === 4 ? 'Four courses' : `${courses.length} courses`}, in the order you&apos;ll need them</h2>
            <ul className="courses">
              {courses.map((c) => (
                <li className="course" key={c.id} style={{ '--c': `var(--${c.tier})` } as React.CSSProperties}>
                  <span className="t">{TIER_NAME[c.tier]}</span>
                  <h3>{c.title}</h3>
                  <p>{c.summary}</p>
                  <small>{c.requirement ?? `${c.lessons} lesson${c.lessons === 1 ? '' : 's'}, ${c.minutes} minutes`}</small>
                </li>
              ))}
            </ul>
          </div></section>
        ) : null}

        <section className="sec" id="verify" style={{ paddingTop: 0 }} aria-labelledby="verify-title"><div className="wrap">
          <div className="certstrip">
            <div>
              <h2 id="verify-title">A certificate that means something because anyone can check it</h2>
              <p>Every certificate has a code and a public page. An employer, a partner or a regulator can confirm it in one click, without an account.</p>
              <Link href="/verify" className="linkbtn">Verify a certificate</Link>
            </div>
            <div className="cert" aria-label="An example certificate">
              <div className="cap">CERTIFICATE OF ACHIEVEMENT</div>
              <h3>Your name</h3>
              <div className="small" style={{ fontSize: 14 }}>has completed and verified</div>
              <div className="ff" style={{ fontSize: 17, fontWeight: 600, marginTop: 6 }}>{courses[0]?.title ?? 'A course'}</div>
              <div className="foot"><div><div className="small">VERIFICATION CODE</div><div className="serial">PA-XXXX-XXXX</div></div><div className="small">Checked at this academy&apos;s verify page</div></div>
            </div>
          </div>
        </div></section>
      </main>
      <Footer />
    </div>
  );
}
