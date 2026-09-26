'use client';
/**
 * Check questions (and a course's placement questions): each one a
 * prompt, two to five options, the right one, and a rationale for every
 * option, because a learner reads the rationale for the one they chose.
 *
 * Each input carries its path in the request body, so an API message
 * about it appears beneath it, and a folded question opens to show one.
 */
import { useEffect, useId, useState } from 'react';
import { KEYS, blankQuestion, type Question } from '@/lib/content';
import { TIER_NAME, TIERS, type Tier } from '@/lib/format';
import { useErrorUnder, useInvalid } from './Form';
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

function Prompt({ path, n, value, onChange }: { path: string; n: number; value: string; onChange(v: string): void }) {
  const id = useId();
  const bad = useInvalid(path);
  return (
    <div className="field">
      <label htmlFor={id}>Question</label>
      <textarea id={id} {...bad.props} className="textarea short-text" value={value} maxLength={500}
        aria-label={`Question ${n}`} onChange={(e) => onChange(e.target.value)} />
      {bad.message}
    </div>
  );
}

function OptionRow({ path, n, index, row, removable, readOnly, onSet, onRemove }: {
  path: string; n: number; index: number; row: { text: string; rationale: string; correct: boolean };
  removable: boolean; readOnly: boolean; onSet(patch: Partial<typeof row>): void; onRemove(): void;
}) {
  const key = KEYS[index]!;
  const upper = key.toUpperCase();
  const text = useInvalid(`${path}.options.${index}.text`);
  const why = useInvalid(`${path}.rationales.${key}`);
  return (
    <div className={`opt ${row.correct ? 'right' : ''}`}>
      <span className="letter" aria-hidden="true">{upper}</span>
      <div className="stack-sm">
        <input {...text.props} className="input" aria-label={`Option ${upper} of question ${n}`} value={row.text} maxLength={300}
          placeholder={`Option ${upper}`} onChange={(e) => onSet({ text: e.target.value })} />
        {text.message}
        <textarea {...why.props} className="textarea short-text" aria-label={`Why option ${upper} is right or wrong`} value={row.rationale} maxLength={600}
          placeholder={`Why ${upper} is ${row.correct ? 'right' : 'wrong'}, in a sentence a learner can use`}
          onChange={(e) => onSet({ rationale: e.target.value })} />
        {why.message}
        <div className="row">
          <label className="check">
            <input type="radio" name={`${path}-correct`} checked={row.correct} onChange={() => onSet({ correct: true })} />
            The right answer
          </label>
          {removable && !readOnly ? <button type="button" className="btn ghost" onClick={onRemove}>Remove option {upper}</button> : null}
        </div>
      </div>
    </div>
  );
}

function QuestionCard({ q, n, path, onChange, onRemove, withTier, readOnly }: {
  q: Q; n: number; path: string; onChange(q: Q): void; onRemove(): void; withTier: boolean; readOnly: boolean;
}) {
  const complete = !!q.prompt.trim() && q.options.every((o) => o.text.trim() && (q.rationales[o.key] ?? '').trim());
  // A finished question folds away; one still being written stays open, and so does one with a problem.
  const [open, setOpen] = useState(!complete);
  const troubled = useErrorUnder(path);
  useEffect(() => { if (troubled) setOpen(true); }, [troubled]);
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
        <span className={`chip ${troubled ? 'danger' : complete ? 'success' : 'caution'}`}>{troubled ? 'Needs changing' : complete ? 'Complete' : 'Unfinished'}</span>
        <Icon name="next" />
      </summary>
      <fieldset className="qbody" disabled={readOnly}>
        <legend className="visually-hidden">Question {n}</legend>
        {readOnly ? null : <div className="row end"><button type="button" className="btn ghost" onClick={onRemove}><Icon name="trash" />Remove question {n}</button></div>}
        {withTier ? (
          <div className="field">
            <label htmlFor={`${path}-tier`}>Tier it measures</label>
            <select id={`${path}-tier`} className="select" value={q.tier ?? 'learn'} onChange={(e) => onChange({ ...q, tier: e.target.value as Tier })}>
              {TIERS.map((t) => <option key={t} value={t}>{TIER_NAME[t]}</option>)}
            </select>
          </div>
        ) : null}
        <Prompt path={`${path}.prompt`} n={n} value={q.prompt} onChange={(prompt) => onChange({ ...q, prompt })} />
        <div className="options">
          {rows(q).map((r, i) => (
            <OptionRow key={KEYS[i]} path={path} n={n} index={i} row={r} removable={q.options.length > 2} readOnly={readOnly}
              onSet={(patch) => set(i, patch)} onRemove={() => onChange(relabel(q, rows(q).filter((_, j) => j !== i)))} />
          ))}
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

export function QuestionsEditor({ questions, onChange, path = 'questions', min, withTier = false, readOnly = false, noun = 'check question' }: {
  questions: Q[];
  onChange(questions: Q[]): void;
  /** Where the questions sit in the request body: questions, or placementQuestions. */
  path?: string;
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
        <QuestionCard key={q.id ?? `new-${i}`} q={q} n={i + 1} path={`${path}.${i}`} withTier={withTier} readOnly={readOnly}
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

function TranscriptLine({ path, i, line, onChange, onRemove }: {
  path: string; i: number; line: { at: string; text: string }; onChange(l: { at: string; text: string }): void; onRemove(): void;
}) {
  const at = useInvalid(`${path}.${i}.at`);
  const text = useInvalid(`${path}.${i}.text`);
  return (
    <div className="stack-sm">
      <div className="transcript-row">
        <input {...at.props} className="input short" aria-label={`Time of line ${i + 1}, as minutes:seconds`} placeholder="0:00" value={line.at}
          onChange={(e) => onChange({ ...line, at: e.target.value })} />
        <input {...text.props} className="input" aria-label={`Words of line ${i + 1}`} value={line.text} maxLength={500}
          onChange={(e) => onChange({ ...line, text: e.target.value })} />
        <button type="button" className="btn ghost" aria-label={`Remove line ${i + 1}`} onClick={onRemove}><Icon name="trash" /></button>
      </div>
      {at.message}{text.message}
    </div>
  );
}

export function TranscriptEditor({ lines, path = 'transcript', onChange }: {
  lines: { at: string; text: string }[]; path?: string; onChange(lines: { at: string; text: string }[]): void;
}) {
  return (
    <div className="stack-sm">
      {lines.map((l, i) => (
        <TranscriptLine key={i} path={path} i={i} line={l}
          onChange={(next) => onChange(lines.map((x, j) => (j === i ? next : x)))} onRemove={() => onChange(lines.filter((_, j) => j !== i))} />
      ))}
      <button type="button" className="btn" onClick={() => onChange([...lines, { at: '', text: '' }])}><Icon name="plus" />Add a transcript line</button>
    </div>
  );
}
