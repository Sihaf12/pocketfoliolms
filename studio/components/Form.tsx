'use client';
/**
 * Form pieces, so every field, error and problem list reads the same.
 *
 * An API error can name fields (fields: [{ field, message }], with dotted
 * paths into the request body). Inside an ErrorScope, a Field with that
 * name shows its message beneath itself; whatever no field on screen
 * claims is listed at the top of the scope. Either way the person is
 * taken to it: the first named field gets focus, or else the list does.
 */
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { FIELD_NAME } from '@/lib/format';

const ScopeError = createContext<unknown>(null);

/** The API's message for one field, if the error in scope names it. */
export function useFieldError(name: string | undefined): string | null {
  const error = useContext(ScopeError);
  if (!name || !(error instanceof ApiError)) return null;
  return error.fields.get(name) ?? null;
}

/** True if the error in scope names this field or anything under it, such as questions.2. */
export function useErrorUnder(prefix: string): boolean {
  const error = useContext(ScopeError);
  return error instanceof ApiError && [...error.fields.keys()].some((f) => f === prefix || f.startsWith(`${prefix}.`));
}

export function ErrorScope({ error, children }: { error: unknown; children: React.ReactNode }) {
  return (
    <ScopeError.Provider value={error}>
      <Problem error={error} />
      {children}
    </ScopeError.Provider>
  );
}

export interface FieldProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'data-field'?: string;
}

export function Field({ label, name, hint, error, children }: {
  label: string;
  /** The field's path in the request body, so an API error about it lands here. */
  name?: string;
  hint?: React.ReactNode;
  /** A message worked out here, before anything is sent. */
  error?: string | null;
  children: (props: FieldProps) => React.ReactNode;
}) {
  const id = useId();
  const fromApi = useFieldError(name);
  const shown = error || fromApi;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = shown ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? <p className="hint" id={hintId}>{hint}</p> : null}
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': shown ? true : undefined, 'data-field': name })}
      {shown ? <FieldMessage id={errorId!} message={shown} /> : null}
    </div>
  );
}

/**
 * For inputs and groups that are not a single Field, such as a question's
 * options or a set of role checkboxes: the attributes that tie the element
 * to its API message, and the message to put beneath it.
 */
export function useInvalid(path: string) {
  const id = useId();
  const message = useFieldError(path);
  return {
    props: { 'data-field': path, 'aria-invalid': message ? true : undefined, 'aria-describedby': message ? `${id}-e` : undefined },
    message: message ? <FieldMessage id={`${id}-e`} message={message} /> : null,
  };
}

/** A message beneath a field. Also used by inputs that are not in a Field, such as a question's options. */
export function FieldMessage({ id, message }: { id?: string; message: string }) {
  return <p className="error" id={id}>{message}</p>;
}

/** What went wrong: the message, the list of things to fix, and any field problem no field on screen shows. */
export function Problem({ error }: { error: unknown }) {
  const box = useRef<HTMLDivElement>(null);
  const [unclaimed, setUnclaimed] = useState<[string, string][]>([]);

  useEffect(() => {
    if (!error) { setUnclaimed([]); return; }
    const fields = error instanceof ApiError ? [...error.fields] : [];
    const onScreen = (name: string) => document.querySelector<HTMLElement>(`[data-field="${CSS.escape(name)}"]`);
    setUnclaimed(fields.filter(([name]) => !onScreen(name)));
    // Take the person to the problem, wherever they are on the page.
    const first = fields.map(([name]) => onScreen(name)).find(Boolean);
    const target = first ?? box.current;
    target?.scrollIntoView({ block: 'center' });
    target?.focus({ preventScroll: true });
  }, [error]);

  if (!error) return null;
  const message = error instanceof ApiError ? error.message : 'That did not work. Try again in a moment.';
  const problems = error instanceof ApiError ? error.problems : [];
  const fields = error instanceof ApiError ? error.fields.size : 0;
  return (
    <div className="notice danger" role="alert" tabIndex={-1} ref={box}>
      <p>{message}{fields > unclaimed.length ? ' The fields concerned are marked below.' : ''}</p>
      {problems.length || unclaimed.length ? (
        <ul>
          {problems.map((p) => <li key={p}>{p}</li>)}
          {unclaimed.map(([name, text]) => <li key={name}>{labelFor(name)}: {text}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

/** "questions.2.prompt" as a person would say it: "Question 3, question text". */
export function labelFor(path: string): string {
  const parts = path.split('.');
  const words: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const next = parts[i + 1];
    if ((part === 'questions' || part === 'placementQuestions' || part === 'transcript' || part === 'options') && next && /^\d+$/.test(next)) {
      const noun = part === 'transcript' ? 'Transcript line' : part === 'options' ? 'Option' : 'Question';
      words.push(part === 'options' ? `${noun} ${String.fromCharCode(65 + Number(next))}` : `${noun} ${Number(next) + 1}`);
      i++;
    } else if (part === 'rationales' && next) {
      words.push(`why ${next.toUpperCase()}`);
      i++;
    } else if (part === 'tokens' && next) {
      words.push(next);
      i++;
    } else {
      words.push(FIELD_NAME[part] ?? part);
    }
  }
  return words.join(', ');
}
