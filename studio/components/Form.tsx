'use client';
/** Small form pieces, so every field, error and problem list reads the same. */
import { useId } from 'react';
import { ApiError } from '@/lib/api';

export function Field({ label, hint, error, children }: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => React.ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? <p className="hint" id={hintId}>{hint}</p> : null}
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? <p className="error" id={errorId}>{error}</p> : null}
    </div>
  );
}

/** What went wrong, and the list of things to fix when there is one. */
export function Problem({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : 'That did not work. Try again in a moment.';
  const problems = error instanceof ApiError ? error.problems : [];
  return (
    <div className="notice danger" role="alert">
      <p>{message}</p>
      {problems.length ? <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
    </div>
  );
}
