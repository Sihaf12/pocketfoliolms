'use client';
/**
 * Check questions (and a course's placement questions): each one a
 * prompt, two to five options, the right one, and a rationale for every
 * option, because a learner reads the rationale for the one they chose.
 */
import { useState } from 'react';
import { KEYS, blankQuestion, type Question } from '@/lib/content';
import { TIER_NAME, TIERS, type Tier } from '@/lib/format';
import { Icon } from './Icon';

type Q = Question & { tier?: Tier };

/** Letters follow the order of the options, so removing B makes C the new B. */
function relabel(q: Q, texts: { text: string; rationale: string; correct: boolean }[]): Q {
  const options = texts.map((t, i) => ({ key: KEYS[i]!, text: t.text }));
  const rationales = Object.fromEntries(texts.map((t, i) => [KEYS[i]!, t.rationale]));
  const correct = texts.findIndex((t) => t.correct);
  return { ...q, options, rationales, correctKey: KEYS[Math.max(0, correct)]! };
}

function rows(q: Q) {
  return q.options.map((o) => ({ text: o.text, rationale: q.rationales[o.key] ?? '', correct: o.key === q.correctKey }));
}

function QuestionCard({ q, n, onChange, onRemove, withTier, readOnly }: {
  q: Q; n: number; onChange(q: Q): void; onRemove(): void; withTier: boolean; readOnly: boolean;
}) {
  const name = `q${n}`;
  const complete = !!q.prompt.trim() && q.options.every((o) => o.text.trim() && (q.rationales[o.key] ?? '').trim());
  // A finished question folds away; one still being written stays open.
  const [open, setOpen] = useState(!complete);
  const set = (i: number, patch: Partial<{ text: string; rationale: string; correct: boolean }>) => {
    const next = rows(q).map((r, j) => (patch.correct ? { ...r, correct: j === i } : j === i ? { ...r, ...patch } : r));
    onChange(relabel(q, next));
  };
  return (
    <details className="card qcard" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="grow">
          <span className="title">Question {n}</span>
          <span className="excerpt">{q.prompt.trim() || 'Not written yet'}</span>
        </span>
        <span className={`chip ${complete ? 'success' : 'caution'}`}>{complete ? 'Complete' : 'Unfinished'}</span>
        <Icon name="next" />
      </summary>
    <fieldset className="qbody" disabled={readOnly}>
      <legend className="visually-hidden">Question {n}</legend>
      {readOnly ? null : <div className="row end"><button type="button" className="btn ghost" onClick={onRemove}><Icon name="trash" />Remove question {n}</button></div>}
      {withTier ? (
        <div className="field">
          <label htmlFor={`${name}-tier`}>Tier it measures</label>
          <select id={`${name}-tier`} className="select" value={q.tier ?? 'learn'} onChange={(e) => onChange({ ...q, tier: e.target.value as Tier })}>
            {TIERS.map((t) => <option key={t} value={t}>{TIER_NAME[t]}</option>)}
          </select>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor={`${name}-prompt`}>Question</label>
        <textarea id={`${name}-prompt`} className="textarea short-text" value={q.prompt} maxLength={500} onChange={(e) => onChange({ ...q, prompt: e.target.value })} />
      </div>
      <div className="options">
        {rows(q).map((r, i) => {
          const key = KEYS[i]!;
          const upper = key.toUpperCase();
          return (
            <div className={`opt ${r.correct ? 'right' : ''}`} key={key}>
              <span className="letter" aria-hidden="true">{upper}</span>
              <div className="stack-sm">
                <input className="input" aria-label={`Option ${upper} of question ${n}`} value={r.text} maxLength={300}
                  placeholder={`Option ${upper}`} onChange={(e) => set(i, { text: e.target.value })} />
                <textarea className="textarea short-text" aria-label={`Why option ${upper} is right or wrong`} value={r.rationale} maxLength={600}
                  placeholder={`Why ${upper} is ${r.correct ? 'right' : 'wrong'}, in a sentence a learner can use`}
                  onChange={(e) => set(i, { rationale: e.target.value })} />
                <div className="row">
                  <label className="check">
                    <input type="radio" name={`${name}-correct`} checked={r.correct} onChange={() => set(i, { correct: true })} />
                    The right answer
                  </label>
                  {q.options.length > 2 && !readOnly ? (
                    <button type="button" className="btn ghost" onClick={() => onChange(relabel(q, rows(q).filter((_, j) => j !== i)))}>
                      Remove option {upper}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {q.options.length < KEYS.length && !readOnly ? (
        <button type="button" className="btn" onClick={() => onChange(relabel(q, [...rows(q), { text: '', rationale: '', correct: false }]))}>
          <Icon name="plus" />Add an option
        </button>
      ) : null}
    </fieldset>
    </details>
  );
}

export function QuestionsEditor({ questions, onChange, min, withTier = false, readOnly = false, noun = 'check question' }: {
  questions: Q[];
  onChange(questions: Q[]): void;
  min?: number;
  withTier?: boolean;
  readOnly?: boolean;
  noun?: string;
}) {
  const enough = min === undefined || questions.length >= min;
  return (
    <div className="stack">
      {min !== undefined ? (
        <p className="row">
          <span className={`chip ${enough ? 'success' : 'caution'}`}>{questions.length} of {min} needed</span>
          <span className="soft small">Each check draws 3, so a bank of {min} or more gives every retake a different paper.</span>
        </p>
      ) : null}
      {questions.map((q, i) => (
        <QuestionCard key={q.id ?? `new-${i}`} q={q} n={i + 1} withTier={withTier} readOnly={readOnly}
          onChange={(next) => onChange(questions.map((x, j) => (j === i ? next : x)))}
          onRemove={() => onChange(questions.filter((_, j) => j !== i))} />
      ))}
      {readOnly ? null : (
        <button type="button" className="btn" onClick={() => onChange([...questions, withTier ? { ...blankQuestion(), tier: 'learn' } : blankQuestion()])}>
          <Icon name="plus" />Add a {noun}
        </button>
      )}
    </div>
  );
}

export function TranscriptEditor({ lines, onChange }: { lines: { at: string; text: string }[]; onChange(lines: { at: string; text: string }[]): void }) {
  return (
    <div className="stack-sm">
      {lines.map((l, i) => (
        <div className="transcript-row" key={i}>
          <input className="input short" aria-label={`Time of line ${i + 1}, as minutes:seconds`} placeholder="0:00" value={l.at}
            pattern="[0-9]{1,2}:[0-5][0-9]" onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, at: e.target.value } : x)))} />
          <input className="input" aria-label={`Words of line ${i + 1}`} value={l.text} maxLength={500}
            onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          <button type="button" className="btn ghost" aria-label={`Remove line ${i + 1}`} onClick={() => onChange(lines.filter((_, j) => j !== i))}>
            <Icon name="trash" />
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => onChange([...lines, { at: '', text: '' }])}><Icon name="plus" />Add a transcript line</button>
    </div>
  );
}
