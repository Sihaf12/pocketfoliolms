'use client';
/**
 * Learner form pieces in the design's style. An API refusal about a
 * field shows beneath that field; anything else at the top, in view.
 */
import { useEffect, useId, useRef } from 'react';
import { ApiError } from '@/lib/api';

export function fieldMessage(error: unknown, name: string): string | null {
  return error instanceof ApiError ? error.fields.get(name) ?? null : null;
}

export function Problem({ error, names = [] }: { error: unknown; names?: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const claimed = error instanceof ApiError && names.some((n) => error.fields.has(n));
  useEffect(() => { if (error && !claimed) { box.current?.scrollIntoView({ block: 'center' }); box.current?.focus({ preventScroll: true }); } }, [error, claimed]);
  if (!error || claimed) return null;
  const message = error instanceof ApiError ? error.message : 'That did not work. Try again in a moment.';
  return <div className="problem" role="alert" tabIndex={-1} ref={box}>{message}</div>;
}

export function LField({ label, name, error, hint, ...input }: {
  label: string; name: string; error: unknown; hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const message = fieldMessage(error, name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (message) ref.current?.focus(); }, [message]);
  const described = [hint ? `${id}-h` : '', message ? `${id}-e` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input ref={ref} id={id} name={name} aria-invalid={message ? true : undefined} aria-describedby={described} {...input} />
      {hint ? <p className="crumb" id={`${id}-h`} style={{ marginTop: 6 }}>{hint}</p> : null}
      {message ? <p className="err" id={`${id}-e`}>{message}</p> : null}
    </div>
  );
}

/**
 * One choice from a few: the design's pills and 1 to 5 rows, as a radio
 * group. Arrow keys move the choice; Tab enters and leaves the group.
 */
export function Choice<T extends string | number>({ label, options, value, onChange, className, itemClass, labelledBy }: {
  label?: string;
  labelledBy?: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange(v: T): void;
  className: string;
  itemClass?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = options.findIndex((o) => o.value === value);
  const move = (i: number) => {
    const next = (i + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div className={className} role="radiogroup" aria-label={label} aria-labelledby={labelledBy}>
      {options.map((o, i) => (
        <button key={String(o.value)} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" className={itemClass}
          aria-checked={o.value === value} tabIndex={i === (current < 0 ? 0 : current) ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i - 1); }
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
