'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { call } from '@/lib/api';
import { ErrorScope, Field } from '../Form';
import { useWorkspace } from '../Workspace';

/** A page link from ?next=, only ever within this workspace. */
function safeNext(raw: string | null, fallback: string): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('/sign-in') ? raw : fallback;
}

export function SignIn() {
  const ws = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const console = ws.kind === 'console';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call(ws.api('/auth/login'), { method: 'POST', body: console && code ? { email, password, code } : { email, password } });
      router.replace(safeNext(params.get('next'), ws.href('/')));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="stack solo">
      <div className="head">
        <div>
          <h1>{console ? 'Sign in to the console' : `Sign in to the ${ws.place} studio`}</h1>
          <p>{console
            ? 'Platform courses, the glossary, and every academy.'
            : 'Write and review lessons, and run the academy.'}</p>
        </div>
      </div>
      <form className="card stack" onSubmit={submit} noValidate>
        <ErrorScope error={error}>
        <Field label="Email" name="email">{(p) => <input {...p} className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password" name="password">{(p) => <input {...p} className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        {console ? (
          <Field label="Code from your authenticator" name="code" hint="Six digits. Owners always need one; other staff only once they have set it up.">
            {(p) => <input {...p} className="input code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
          </Field>
        ) : null}
        <button className="btn primary block" type="submit" disabled={busy}>{console ? 'Sign in to the console' : 'Sign in to the studio'}</button>
        </ErrorScope>
      </form>
    </div>
  );
}
