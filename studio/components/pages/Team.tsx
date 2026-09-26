'use client';
/**
 * Who works in the studio (or on the platform), and inviting more. An
 * invitation link is shown once, to the person who made it, and works
 * once, for 72 hours. Nothing is emailed from here.
 */
import { useRef, useState } from 'react';
import { call } from '@/lib/api';
import { ROLE_NAME, day } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Head, Loading } from '../bits';
import { ErrorScope, Field, Problem, useInvalid } from '../Form';
import { Icon } from '../Icon';
import { OneTimeLink } from '../OneTimeLink';
import { useWorkspace } from '../Workspace';

interface Person { id: string; email: string; displayName: string; roles?: string[]; role?: string }
interface Invitation { id: string; email: string; roles?: string[]; role?: string; expiresAt: string; state?: 'pending' | 'expired' }

const STUDIO_ROLES = [
  { role: 'author', says: 'Writes courses and lessons.' },
  { role: 'reviewer', says: 'Checks the subject matter before compliance sees it.' },
  { role: 'compliance', says: 'Publishes to learners, and withdraws courses.' },
  { role: 'tenant_admin', says: 'Runs the academy: team, learners, catalogue and settings.' },
];
const STAFF_ROLES = [
  { role: 'platform_author', says: 'Writes platform courses, lessons and glossary terms.' },
  { role: 'platform_reviewer', says: 'Checks the subject matter.' },
  { role: 'platform_compliance', says: 'Publishes platform content to every academy.' },
];

/** A set of role choices, which an API message about roles lands beneath. */
function RoleGroup({ name, children }: { name: string; children: React.ReactNode }) {
  const bad = useInvalid(name);
  return <fieldset {...bad.props} tabIndex={-1}>{children}{bad.message}</fieldset>;
}

export function TeamPage() {
  const ws = useWorkspace();
  const studio = ws.kind === 'studio';
  const path = studio ? '/users' : '/staff';
  const { data, error, reload } = useLoad<{ users?: Person[]; staff?: Person[]; invitations: Invitation[] }>(ws.api(path));
  const inviteDialog = useRef<HTMLDialogElement>(null);
  const rolesDialog = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [reissued, setReissued] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const choices = studio ? STUDIO_ROLES : STAFF_ROLES;

  function openInvite() {
    setEmail(''); setPicked([]); setLink(null); setReissued(false); setProblem(null);
    inviteDialog.current?.showModal();
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setProblem(null);
    try {
      const body = studio ? { email, roles: picked } : { email, role: picked[0] };
      const res = await call<{ link: string }>(ws.api(path), { method: 'POST', body });
      setLink(res.link);
      reload();
    } catch (err) {
      ws.handle(err); setProblem(err);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(i: Invitation) {
    try {
      await call(ws.api(`/users/invitations/${i.id}`), { method: 'DELETE' });
      ws.say(`Invitation for ${i.email} withdrawn`);
      reload();
    } catch (err) {
      ws.handle(err); setProblem(err);
    }
  }

  /** A new link for an open invitation; the old one stops working. Shown once, in the invite dialog. */
  async function reissue(i: Invitation) {
    setProblem(null);
    try {
      const res = await call<{ link: string }>(ws.api(`/users/invitations/${i.id}/reissue`), { method: 'POST' });
      setEmail(i.email);
      setReissued(true);
      setLink(res.link);
      inviteDialog.current?.showModal();
      reload();
    } catch (err) {
      ws.handle(err); setProblem(err);
    }
  }

  async function saveRoles(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true); setProblem(null);
    try {
      await call(ws.api(`/users/${editing.id}`), { method: 'PATCH', body: { roles: picked } });
      rolesDialog.current?.close();
      ws.say(picked.length ? `Roles changed for ${editing.displayName}` : `${editing.displayName} no longer has studio access`);
      reload();
    } catch (err) {
      ws.handle(err); setProblem(err);
    } finally {
      setBusy(false);
    }
  }

  const people = data?.users ?? data?.staff ?? [];
  const rolesOf = (p: { roles?: string[]; role?: string }) => p.roles ?? (p.role ? [p.role] : []);

  return (
    <>
      <Head title={studio ? 'Team' : 'Staff'}
        lead={studio ? 'Everyone who works in this studio, and what each of them may do.' : 'Everyone who works on the platform\'s content.'}>
        <button type="button" className="btn primary" onClick={openInvite}><Icon name="plus" />Invite someone</button>
      </Head>
      {problem && !inviteDialog.current?.open && !rolesDialog.current?.open ? <Problem error={problem} /> : null}
      {!data ? <Loading error={error} /> : (
        <>
          <section aria-labelledby="people">
            <h2 id="people">{studio ? 'In the studio' : 'Staff'}</h2>
            <ul className="list">
              {people.map((p) => (
                <li className="item" key={p.id}>
                  <span className="grow"><span className="title">{p.displayName}</span><span className="soft small">{p.email}</span></span>
                  <span className="row tight">{rolesOf(p).map((r) => <span className="chip plain" key={r}>{ROLE_NAME[r] ?? r}</span>)}</span>
                  {studio ? (
                    <button type="button" className="btn ghost" onClick={() => { setEditing(p); setPicked(rolesOf(p)); setProblem(null); rolesDialog.current?.showModal(); }}>
                      Change roles<span className="visually-hidden"> for {p.displayName}</span>
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="invited">
            <h2 id="invited">Invited</h2>
            {data.invitations.length ? (
              <ul className="list">
                {data.invitations.map((i) => (
                  <li className="item" key={i.id}>
                    <span className="grow"><span className="title">{i.email}</span>
                      <span className="soft small">{i.state === 'expired' ? 'Expired' : `Link works until ${day(i.expiresAt)}`}.</span></span>
                    <span className="row tight">{rolesOf(i).map((r) => <span className="chip plain" key={r}>{ROLE_NAME[r] ?? r}</span>)}</span>
                    {i.state === 'expired' ? <span className="chip">Expired</span> : <span className="chip caution">Waiting</span>}
                    {studio ? (
                      <span className="row tight">
                        <button type="button" className="btn ghost" onClick={() => void reissue(i)}>Reissue invitation<span className="visually-hidden"> for {i.email}</span></button>
                        <button type="button" className="btn ghost" onClick={() => void withdraw(i)}>Withdraw<span className="visually-hidden"> the invitation for {i.email}</span></button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <div className="card"><p>No open invitations.</p></div>}
          </section>
        </>
      )}

      {/* The link leaves the page when the dialog closes: it is shown once. */}
      <dialog className="sheet" ref={inviteDialog} aria-labelledby="invite-title" onClose={() => setLink(null)}>
        {link ? (
          <div className="stack">
            <h2 id="invite-title">Send this link to {email}</h2>
            <p className="soft">{reissued ? 'The link sent before no longer works. ' : ''}This one is shown once, here. It works once, for 72 hours. Send it yourself, by a channel you trust.</p>
            <OneTimeLink label="Invitation link" value={link} />
            <div className="row end"><button type="button" className="btn primary" onClick={() => inviteDialog.current?.close()}>Done</button></div>
          </div>
        ) : (
          <form className="stack" onSubmit={invite}>
            <h2 id="invite-title">Invite someone</h2>
            <ErrorScope error={problem}>
            <Field label="Their email" name="email">{(p) => <input {...p} className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            <RoleGroup name={studio ? 'roles' : 'role'}>
              <legend>{studio ? 'Roles' : 'Role'}</legend>
              {choices.map((c) => (
                <label className="check" key={c.role}>
                  <input type={studio ? 'checkbox' : 'radio'} name="role" checked={picked.includes(c.role)}
                    onChange={(e) => setPicked(studio ? (e.target.checked ? [...picked, c.role] : picked.filter((r) => r !== c.role)) : [c.role])} />
                  <span><b>{ROLE_NAME[c.role]}</b>. {c.says}</span>
                </label>
              ))}
            </RoleGroup>
            <div className="row end">
              <button type="button" className="btn" onClick={() => inviteDialog.current?.close()}>Not now</button>
              <button type="submit" className="btn primary" disabled={busy || !email || !picked.length}>Make the invitation link</button>
            </div>
            </ErrorScope>
          </form>
        )}
      </dialog>

      <dialog className="sheet" ref={rolesDialog} aria-labelledby="roles-title">
        <form className="stack" onSubmit={saveRoles}>
          <h2 id="roles-title">Roles for {editing?.displayName}</h2>
          <ErrorScope error={problem}>
          <RoleGroup name="roles">
            <legend className="visually-hidden">Roles</legend>
            {STUDIO_ROLES.map((c) => (
              <label className="check" key={c.role}>
                <input type="checkbox" checked={picked.includes(c.role)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, c.role] : picked.filter((r) => r !== c.role))} />
                <span><b>{ROLE_NAME[c.role]}</b>. {c.says}</span>
              </label>
            ))}
          </RoleGroup>
          <p className="soft small">With no roles, they can no longer sign in to the studio.</p>
          <div className="row end">
            <button type="button" className="btn" onClick={() => rolesDialog.current?.close()}>Keep as it is</button>
            <button type="submit" className="btn primary" disabled={busy}>Save roles</button>
          </div>
          </ErrorScope>
        </form>
      </dialog>
    </>
  );
}
