'use client';
/**
 * Accepting an invitation: the link was shown once to whoever invited
 * this person. The studio asks for a name and a password; the console,
 * for staff, the same with a longer password.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/api';
import { Field, Problem } from '../Form';
import { useWorkspace } from '../Workspace';

export function InvitePage({ token }: { token: string }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const console = ws.kind === 'console';
  const min = 12;

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call(ws.api(console ? '/staff/invitations/accept' : '/invitations/accept'), {
        method: 'POST', body: name.trim() ? { token, password, displayName: name.trim() } : { token, password },
      });
      router.replace(ws.href('/'));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="stack solo">
      <div className="head"><div>
        <h1>{console ? 'Join the platform console' : `Join the ${ws.place} studio`}</h1>
        <p>Choose the name your colleagues will see beside your work, and a password.</p>
      </div></div>
      <form className="card stack" onSubmit={accept} noValidate>
        <Problem error={error} />
        <Field label="Your name">{(p) => <input {...p} className="input" autoComplete="name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Password" hint={console
          ? `At least ${min} characters.`
          : `At least ${min} characters. If you already learn at this academy, use the password you have.`}>
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" minLength={min} value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <button className="btn primary block" type="submit" disabled={busy || !password || (console && (!name.trim() || password.length < min))}>
          {console ? 'Join the console' : 'Join the studio'}
        </button>
      </form>
    </div>
  );
}
