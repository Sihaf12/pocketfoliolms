'use client';
/**
 * Creating an account and signing in. Moving between the two slides the
 * form across, the way the design does; nothing else moves.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { call } from '@/lib/api';
import { LField, Problem } from '../form';
import { Tick } from '../icons';
import { Scene } from '../Scene';
import { PlainTop, SkipLink } from '../Shell';
import { homeFor, useMe, type Me } from '../context';

/** A page link from ?next=, only ever within this academy's learner app. */
function safeNext(raw: string | null): string | null {
  return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/studio') ? raw : null;
}

export function SignUp() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useMe(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ref = params.get('ref');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await call('/api/v1/auth/signup', {
        method: 'POST',
        body: { displayName: name.trim(), email: email.trim(), password, ...(ref ? { ibRefCode: ref } : {}) },
      });
      await refresh();
      router.push('/onboarding');
    } catch (err) {
      setError(err); setBusy(false);
    }
  }

  return (
    <div className="screen">
      <SkipLink />
      <PlainTop />
      <main id="main" className="auth"><div className="wrap stage split">
        <div className={`box ${params.get('via') === 'signin' ? 'from-r' : ''}`}>
          <span className="promise"><Tick />No deposit. No trading. Ever.</span>
          <h1>Create your account</h1>
          <p className="lead">Three minutes to your starting point. Your record belongs to this academy only.</p>
          <form onSubmit={submit} noValidate>
            <Problem error={error} names={['displayName', 'email', 'password']} />
            <LField label="Name" name="displayName" error={error} autoComplete="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            <LField label="Email" name="email" error={error} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <LField label="Password" name="password" error={error} type="password" autoComplete="new-password" hint="At least 12 characters." required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} />
            <label className="chk"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> I agree that this academy keeps my learning record. It is never shared with another academy.</label>
            <button className="btn" type="submit" disabled={busy || !agreed}>Create account</button>
          </form>
          <p className="alt">Already have an account? <Link href="/signin?via=signup" className="linkbtn">Sign in</Link></p>
        </div>
        <aside className="aside" aria-label="What happens next">
          <Scene title="Eight questions. Then a path built around you." body="Skip what you already know, learn what you need next, and earn a certificate anyone can check."
            chips={[{ at: { top: 20, left: 20 }, icon: 'ok', title: 'Skip what you know', sub: 'Placement, 3 minutes' }, { at: { top: 96, right: 22 }, icon: 'xp', title: 'Earn XP', sub: 'Every verified lesson' }]} />
          <div className="acard">
            <div className="srow"><i>1</i><div><b>Placement</b><span>Eight scenarios. Skip any.</span></div></div>
            <div className="srow"><i>2</i><div><b>Your path</b><span>Lessons of six to twelve minutes.</span></div></div>
            <div className="srow"><i>3</i><div><b>Certificate</b><span>A public code anyone can verify.</span></div></div>
          </div>
        </aside>
      </div></main>
    </div>
  );
}

export function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useMe(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await call('/api/v1/auth/login', { method: 'POST', body: { email: email.trim(), password } });
      const me: Me | null = await refresh();
      router.push(safeNext(params.get('next')) ?? homeFor(me?.user.lifecycle ?? 'placed'));
    } catch (err) {
      setError(err); setBusy(false);
    }
  }

  return (
    <div className="screen">
      <SkipLink />
      <PlainTop />
      <main id="main" className="auth"><div className="wrap stage split">
        <div className={`box ${params.get('via') === 'signup' ? 'from-l' : ''}`}>
          <h1>Welcome back</h1>
          <p className="lead">Pick up exactly where you stopped.</p>
          <form onSubmit={submit} noValidate>
            <Problem error={error} names={['email', 'password']} />
            <LField label="Email" name="email" error={error} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <LField label="Password" name="password" error={error} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="btn" type="submit" disabled={busy}>Sign in</button>
          </form>
          <p className="alt">New here? <Link href="/signup?via=signin" className="linkbtn">Create an account</Link></p>
        </div>
        <aside className="aside" aria-label="Your academy">
          <Scene title="Your path is right where you left it." body="Every verified lesson counts towards a certificate anyone can check."
            chips={[{ at: { top: 20, left: 20 }, icon: 'flame', title: 'Streaks', sub: 'Any verified lesson counts' }, { at: { top: 92, right: 22 }, icon: 'xp', title: 'XP', sub: 'For every verified lesson' }]} />
        </aside>
      </div></main>
    </div>
  );
}
