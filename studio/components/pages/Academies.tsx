'use client';
/** The console's academies, for the platform owner: list, create, and look after one. */
import { useRef, useState } from 'react';
import Link from 'next/link';
import { HOSTNAME_FORMAT, SLUG_FORMAT, hostProblem, slugProblem } from '../../../packages/shared/names';
import { call } from '@/lib/api';
import { day } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Head, Loading } from '../bits';
import { ErrorScope, Field } from '../Form';
import { Icon } from '../Icon';
import { useWorkspace } from '../Workspace';
import { OneTimeLink } from '../OneTimeLink';

interface Tenant { id: string; slug: string; name: string; primaryDomain: string; status: 'active' | 'suspended'; createdAt: string }

const StatusChip = ({ status }: { status: string }) =>
  status === 'active' ? <span className="chip success">Active</span> : <span className="chip caution">Suspended</span>;

export function AcademiesPage() {
  const ws = useWorkspace();
  const { data, error } = useLoad<{ tenants: Tenant[] }>(ws.api('/tenants'));
  return (
    <>
      <Head title="Academies" lead="Every broker's academy on the platform.">
        <Link className="btn primary" href={ws.href('/academies/new')}><Icon name="plus" />Add an academy</Link>
      </Head>
      {!data ? <Loading error={error} /> : (
        <ul className="list">
          {data.tenants.map((t) => (
            <li key={t.id}>
              <Link className="item" href={ws.href(`/academies/${t.id}`)}>
                <span className="grow"><span className="title">{t.name}</span><span className="soft small">{t.primaryDomain}</span></span>
                <StatusChip status={t.status} />
                <Icon name="next" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function NewAcademyPage() {
  const ws = useWorkspace();
  const [form, setForm] = useState({ name: '', slug: '', primaryDomain: '', adminEmail: '' });
  const [made, setMade] = useState<{ tenant: Tenant; link: string } | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const known = slugProblem(form.slug) ?? hostProblem(form.primaryDomain);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (known) return;
    setBusy(true); setProblem(null);
    try {
      setMade(await call<{ tenant: Tenant; link: string }>(ws.api('/tenants'), { method: 'POST', body: form }));
    } catch (err) { ws.handle(err); setProblem(err); setBusy(false); }
  }

  const back = { href: ws.href('/academies'), label: 'Academies' };
  if (made) {
    return (
      <>
        <Head title={`${made.tenant.name} is ready`} back={back} lead={`It answers at ${made.tenant.primaryDomain}, with every published platform course switched on.`} />
        <div className="card stack">
          <h2>Send this link to {form.adminEmail}</h2>
          <p className="soft">It makes them the academy&apos;s first admin. It is shown once, here, and works once, for 72 hours.</p>
          <OneTimeLink label="First admin's invitation link" value={made.link} />
        </div>
        <div className="actions"><Link className="btn primary" href={ws.href(`/academies/${made.tenant.id}`)}>Open {made.tenant.name}</Link></div>
      </>
    );
  }

  return (
    <>
      <Head title="Add an academy" back={back} />
      <form className="stack narrow" onSubmit={create}>
        <ErrorScope error={problem}>
        <Field label="Name" name="name" hint="As learners will see it.">{(p) => <input {...p} className="input" required maxLength={100} value={form.name} onChange={set('name')} />}</Field>
        <Field label="Short name" name="slug" hint={SLUG_FORMAT} error={slugProblem(form.slug)}>
          {(p) => <input {...p} className="input mono" required autoCapitalize="none" spellCheck={false} maxLength={40} value={form.slug} onChange={set('slug')} />}
        </Field>
        <Field label="Domain" name="primaryDomain" hint={HOSTNAME_FORMAT} error={hostProblem(form.primaryDomain)}>
          {(p) => <input {...p} className="input" required inputMode="url" autoCapitalize="none" spellCheck={false} value={form.primaryDomain} onChange={set('primaryDomain')} />}
        </Field>
        <Field label="First admin's email" name="adminEmail">{(p) => <input {...p} className="input" type="email" required value={form.adminEmail} onChange={set('adminEmail')} />}</Field>
        <div className="actions"><button className="btn primary" type="submit" disabled={busy || !!known}>Create academy</button></div>
        </ErrorScope>
      </form>
    </>
  );
}

interface TenantDetail { tenant: Tenant; reviewSignoffs: number; openInvitations: number; pendingDomain: string | null }

export function AcademyPage({ tenantId }: { tenantId: string }) {
  const ws = useWorkspace();
  const { data, error, setData } = useLoad<TenantDetail>(ws.api(`/tenants/${tenantId}`));
  const suspendDialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const back = { href: ws.href('/academies'), label: 'Academies' };
  if (!data) return <><Head title="Academy" back={back} /><Loading error={error} /></>;
  const t = data.tenant;

  async function run(work: () => Promise<void>) {
    setBusy(true); setProblem(null);
    try { await work(); } catch (err) { ws.handle(err); setProblem(err); } finally { setBusy(false); }
  }
  const setStatus = (status: 'active' | 'suspended') => run(async () => {
    const res = await call<{ tenant: Tenant }>(ws.api(`/tenants/${t.id}`), { method: 'PATCH', body: { status } });
    suspendDialog.current?.close();
    setData({ ...data, tenant: res.tenant });
    ws.say(status === 'active' ? `${t.name} is back online` : `${t.name} is offline`);
  });
  const override = () => run(async () => {
    const res = await call<{ tenant: Tenant }>(ws.api(`/tenants/${t.id}/domain/override`), { method: 'POST', body: { reason } });
    setData({ ...data, tenant: res.tenant, pendingDomain: null });
    setReason('');
    ws.say(`${t.name} now answers at ${res.tenant.primaryDomain}`);
  });

  return (
    <>
      <Head title={t.name} back={back} lead={<span className="row tight"><StatusChip status={t.status} /><span>Since {day(t.createdAt)}</span></span>} />
      <ErrorScope error={problem}>
      <section aria-labelledby="facts">
        <h2 id="facts">At a glance</h2>
        <dl className="dl card">
          <dt>Domain</dt><dd>{t.primaryDomain}</dd>
          <dt>Short name</dt><dd className="mono">{t.slug}</dd>
          <dt>Review rule</dt><dd>{data.reviewSignoffs} people sign off each change</dd>
          <dt>Open invitations</dt><dd>{data.openInvitations}</dd>
        </dl>
      </section>

      <section aria-labelledby="domain">
        <h2 id="domain">Domain change</h2>
        {data.pendingDomain ? (
          <form className="card stack" onSubmit={(e) => { e.preventDefault(); void override(); }}>
            <p>The academy asked to move to <b>{data.pendingDomain}</b> and has not proved it with its DNS record yet. You can apply it without the record. The reason goes in the platform&apos;s audit log.</p>
            <Field label="Why the record is being skipped" name="reason">{(p) => <textarea {...p} className="textarea short-text" minLength={5} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
            <div className="row end"><button type="submit" className="btn" disabled={busy || reason.trim().length < 5}>Apply {data.pendingDomain} without the record</button></div>
          </form>
        ) : <div className="card"><p>No change waiting. Academies ask for a new domain from their studio settings.</p></div>}
      </section>

      <div className="actions">
        {t.status === 'active'
          ? <button type="button" className="btn" disabled={busy} onClick={() => suspendDialog.current?.showModal()}>Take {t.name} offline</button>
          : <button type="button" className="btn primary" disabled={busy} onClick={() => void setStatus('active')}>Bring {t.name} back online</button>}
      </div>

      <dialog className="sheet" ref={suspendDialog} aria-labelledby="suspend-title">
        <div className="stack">
          <h2 id="suspend-title">Take {t.name} offline?</h2>
          <p className="soft">Its learners and studio see nothing until it is brought back. Nothing is deleted.</p>
          <div className="row end">
            <button type="button" className="btn" onClick={() => suspendDialog.current?.close()}>Keep it online</button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void setStatus('suspended')}>Take it offline</button>
          </div>
        </div>
      </dialog>
      </ErrorScope>
    </>
  );
}
