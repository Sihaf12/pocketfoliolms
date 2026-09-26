'use client';
/**
 * The lesson as a learner will read it, on a phone. The text goes through
 * parseLesson and inline from packages/shared: the same functions the API
 * checks a lesson with, and the learner page's renderer is kept identical
 * to them by a test. What an author sees here is what a learner gets.
 * inline() escapes everything it is given and emits only <b> and the
 * glossary term's span, which is why its output may be set as HTML.
 */
import { inline, parseLesson } from '../../packages/shared/markdown';
import { CHECK_LENGTH, type Question } from '@/lib/content';
import { TIER_NAME, type Tier } from '@/lib/format';

export interface PreviewLesson {
  title: string;
  tier: Tier;
  courseTitle: string;
  position: number;
  minutes: number;
  xp: number;
  bodyMd: string;
  videoAsset: string | null;
  questions: Question[];
}

/** Every [[term|definition]] in the text, so an author can read the definitions without hovering. */
function termsIn(md: string): { term: string; definition: string }[] {
  const seen = new Map<string, string>();
  for (const m of md.matchAll(/\[\[([^\]|]+)\|([^\]]+)\]\]/g)) seen.set(m[1]!, m[2]!);
  return [...seen].map(([term, definition]) => ({ term, definition }));
}

export function LessonPreview({ lesson, label = 'Learner preview' }: { lesson: PreviewLesson; label?: string }) {
  const doc = parseLesson(lesson.bodyMd);
  const terms = termsIn(lesson.bodyMd);

  return (
    <figure className="preview" aria-label={label}>
      <figcaption className="preview-cap">{label}<span>as a learner reads it, at phone width</span></figcaption>
      <div className="phone">
        <article className="learner">
          <span className={`chip ${lesson.tier}`}>{TIER_NAME[lesson.tier]}</span>
          <h2 className="learner-title">{lesson.title || 'Untitled lesson'}</h2>
          <p className="learner-meta">
            Lesson {lesson.position} of {lesson.courseTitle}. {lesson.minutes} minutes, {lesson.xp} XP.
          </p>
          {lesson.videoAsset ? <div className="learner-video">Video: {lesson.videoAsset}</div> : null}

          {doc.steps.length === 0 ? (
            <p className="learner-empty">Steps appear here as you write them. Start one with “## ”.</p>
          ) : doc.steps.map((s, i) => (
            <div className="step" key={`${i}-${s.h}`}>
              <span className="n">{i + 1}</span>
              <div>
                <h4>{s.h}</h4>
                <p dangerouslySetInnerHTML={{ __html: inline(s.p) }} />
              </div>
            </div>
          ))}
          {doc.callout ? (
            <div className="callout">
              <h5>{doc.callout.h}</h5>
              <p dangerouslySetInnerHTML={{ __html: inline(doc.callout.p) }} />
            </div>
          ) : null}

          {terms.length ? (
            <dl className="learner-terms">
              {terms.map((t) => (
                <div key={t.term}><dt>{t.term}</dt><dd>{t.definition}</dd></div>
              ))}
            </dl>
          ) : null}

          <div className="learner-check">
            <h3>Check your understanding</h3>
            <p>
              {lesson.questions.length >= CHECK_LENGTH
                ? `${CHECK_LENGTH} of the ${lesson.questions.length} questions below are drawn each time. 2 of 3 correct to pass.`
                : `Each check draws ${CHECK_LENGTH} questions, and 2 of 3 correct passes. ${lesson.questions.length ? `This lesson has ${lesson.questions.length} so far.` : 'No questions yet.'}`}
            </p>
            {lesson.questions.map((q, i) => (
              <div className="learner-q" key={q.id ?? `new-${i}`}>
                <p className="learner-prompt">{i + 1}. {q.prompt || 'Question text'}</p>
                {q.options.map((o) => (
                  <div className={`option ${o.key === q.correctKey ? 'right' : ''}`} key={o.key}>
                    <span className="letter">{o.key.toUpperCase()}</span>
                    <div>
                      <span>{o.text || 'Option text'}</span>
                      {o.key === q.correctKey ? <span className="why"><span className="mark">Right answer. </span>{q.rationales[o.key]}</span>
                        : q.rationales[o.key] ? <span className="why">{q.rationales[o.key]}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </article>
      </div>
    </figure>
  );
}
