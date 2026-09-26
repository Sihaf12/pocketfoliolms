'use client';
/** The academy's settings, one page each, for its admins. */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BRAND_TOKENS, COLOUR, RADIUS, resolveTokens, type BrandToken, type Tokens } from '../../../packages/shared/brand';
import { checkPalette } from '../../../packages/shared/contrast';
import { call } from '@/lib/api';
import { useLoad } from '@/lib/useLoad';
import { Head, Loading } from '../bits';
import { Field, Problem } from '../Form';
import { Icon, type IconName } from '../Icon';
import { useWorkspace } from '../Workspace';
import { CopyLink } from './Team';

const PAGES: { path: string; label: string; says: string; icon: IconName }[] = [
  { path: '/settings/brand', label: 'Brand', says: 'The ten colours and the corner radius learners see.', icon: 'palette' },
  { path: '/settings/review', label: 'Review rule', says: 'How many people sign off a change before learners see it.', icon: 'check' },
  { path: '/settings/domain', label: 'Domain', says: 'The address your academy answers on.', icon: 'globe' },
  { path: '/settings/crm', label: 'CRM endpoint', says: 'Where new leads and progress events are sent.', icon: 'link' },
  { path: '/settings/deliveries', label: 'Deliveries', says: 'Events waiting for your CRM, and any that failed.', icon: 'send' },
];

export function SettingsPage() {
  const ws = useWorkspace();
  return (
    <>
      <Head title="Settings" lead="How your academy looks, who signs off content, and where it sends events." />
      <ul className="list">
        {PAGES.map((p) => (
          <li key={p.path}>
            <Link className="item" href={ws.href(p.path)}>
              <Icon name={p.icon} />
              <span className="grow"><span className="title">{p.label}</span><span className="soft small">{p.says}</span></span>
              <Icon name="next" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

const back = (ws: ReturnType<typeof useWorkspace>) => ({ href: ws.href('/settings'), label: 'Settings' });

/* ---------- Brand ---------- */

const expand = (hex: string) => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex).toUpperCase();

export function BrandPage() {
  const ws = useWorkspace();
  const { data, error } = useLoad<{ brand: { sub: string; tokens: Partial<Tokens> } }>(ws.api('/settings/brand'));
  const [sub, setSub] = useState('');
  const [tokens, setTokens] = useState<Tokens | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) { setSub(data.brand.sub); setTokens(resolveTokens(data.brand.tokens)); }
  }, [data]);

  if (!data || !tokens) return <><Head title="Brand" back={back(ws)} /><Loading error={error} /></>;
  const valid = BRAND_TOKENS.every((t) => (t.kind === 'colour' ? COLOUR : RADIUS).test(tokens[t.name]));
  const palette = valid ? checkPalette(tokens) : { ok: false, failures: [] };
  const set = (name: BrandToken, value: string) => setTokens({ ...tokens, [name]: value });

  async function save() {
    setBusy(true); setProblem(null);
    try {
      await call(ws.api('/settings/brand'), { method: 'PUT', body: { sub, tokens } });
      ws.say('Brand saved. Learners see it on their next page.');
    } catch (err) {
      ws.handle(err); setProblem(err);
    } finally {
      setBusy(false);
    }
  }

  const sample = Object.fromEntries(BRAND_TOKENS.map((t) => [t.name, tokens[t.name]])) as React.CSSProperties;

  return (
    <>
      <Head title="Brand" back={back(ws)} lead="Colours and one corner radius. Type, spacing and the tier colours stay the same in every academy." />
      <div className="brand-layout">
        <div className="stack brand-aside">
          <figure className="brand-sample" style={sample}>
            <figcaption className="small soft">A sample in these colours</figcaption>
            <div className="brand-card">
              <b>{ws.place}</b>
              <span>{sub || 'Your tagline'}</span>
              <p>Body text a learner reads, and <span className="brand-link">a link</span>.</p>
              <div className="row tight"><span className="brand-btn">Start lesson</span><span className="brand-earned">Verified</span></div>
            </div>
          </figure>
          <div className="stack-sm" aria-live="polite">
            <h2>Readability</h2>
            <p className="soft small">Each pair must reach 4.5 to 1, or the academy cannot save it.</p>
            <ul className="list">
              {!valid ? <li className="item"><span className="chip caution">Fix the values above to check them</span></li>
                : palette.ok ? <li className="item"><span className="chip success">Every pair is readable</span></li>
                  : palette.failures.map((f) => (
                    <li className="item" key={`${f.text}-${f.on}`}>
                      <span className="grow"><span className="title">{f.use}</span><span className="soft small mono">{f.text} on {f.on}: {f.ratio} to 1</span></span>
                      <span className="chip danger">Too faint</span>
                    </li>
                  ))}
            </ul>
          </div>
        </div>
        <div className="stack">
          <Problem error={problem} />
          <Field label="Tagline" hint="A few words under the academy's name.">{(p) => <input {...p} className="input" maxLength={80} value={sub} onChange={(e) => setSub(e.target.value)} />}</Field>
          <fieldset className="tokens">
            <legend>Colours and corner radius</legend>
            {BRAND_TOKENS.map((t) => {
              const value = tokens[t.name];
              const ok = (t.kind === 'colour' ? COLOUR : RADIUS).test(value);
              return (
                <div className="token" key={t.name}>
                  <label htmlFor={`tok-${t.name}`}><span>{t.purpose}</span><span className="mono soft small">{t.name}</span></label>
                  <div className="row tight">
                    {t.kind === 'colour' ? (
                      <input type="color" aria-label={`Pick ${t.name}`} className="swatch" value={ok ? expand(value) : '#000000'} onChange={(e) => set(t.name, e.target.value.toUpperCase())} />
                    ) : null}
                    <input id={`tok-${t.name}`} className="input mono token-value" value={value} aria-invalid={!ok || undefined}
                      onChange={(e) => set(t.name, e.target.value.trim())} />
                  </div>
                  {!ok ? <p className="error small">{t.kind === 'colour' ? 'Use #RGB or #RRGGBB.' : 'Use whole pixels, such as 12px.'}</p> : null}
                </div>
              );
            })}
          </fieldset>
        </div>

      </div>
      <div className="actions">
        <p className="status">{palette.ok ? 'Every pair is readable.' : 'Fix the pairs marked too faint to save.'}</p>
        <button type="button" className="btn primary" disabled={busy || !palette.ok} onClick={() => void save()}>Save brand</button>
      </div>
    </>
  );
}

/* ---------- Review rule ---------- */

export function ReviewRulePage() {
  const ws = useWorkspace();
  const { data, error } = useLoad<{ signoffs: number }>(ws.api('/settings/review'));
  const [value, setValue] = useState<number | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  useEffect(() => { if (data) setValue(data.signoffs); }, [data]);
  if (!data || value === null) return <><Head title="Review rule" back={back(ws)} /><Loading error={error} /></>;

  async function save() {
    setProblem(null);
    try {
      await call(ws.api('/settings/review'), { method: 'PUT', body: { signoffs: value } });
      ws.say('Review rule saved');
    } catch (err) { ws.handle(err); setProblem(err); }
  }

  return (
    <>
      <Head title="Review rule" back={back(ws)} lead="The author never publishes their own work. Beyond that, choose how many different people sign off." />
      <Problem error={problem} />
      <fieldset className="card stack">
        <legend className="visually-hidden">People who sign off a change</legend>
        <label className="check"><input type="radio" name="signoffs" checked={value === 2} onChange={() => setValue(2)} />
          <span><b>Two people.</b> The author, and someone else in compliance who publishes.</span></label>
        <label className="check"><input type="radio" name="signoffs" checked={value === 3} onChange={() => setValue(3)} />
          <span><b>Three people.</b> The author, a different reviewer, and a different person in compliance.</span></label>
      </fieldset>
      <div className="actions">
        <button type="button" className="btn primary" disabled={value === data.signoffs} onClick={() => void save()}>Save review rule</button>
      </div>
    </>
  );
}

/* ---------- Domain ---------- */

interface Pending { id: string; domain: string; requestedAt: string; record: { type: string; name: string; value: string } }

export function DomainPage() {
  const ws = useWorkspace();
  const { data, error, reload } = useLoad<{ domain: string; pending: Pending | null }>(ws.api('/settings/domain'));
  const [domain, setDomain] = useState('');
  const [problem, setProblem] = useState<unknown>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return <><Head title="Domain" back={back(ws)} /><Loading error={error} /></>;

  async function run(work: () => Promise<void>) {
    setBusy(true); setProblem(null);
    try { await work(); } catch (err) { ws.handle(err); setProblem(err); } finally { setBusy(false); }
  }
  const request = () => run(async () => {
    await call(ws.api('/settings/domain'), { method: 'POST', body: { domain: domain.trim().toLowerCase() } });
    setDomain(''); reload();
  });
  const verify = () => run(async () => {
    const res = await call<{ domain: string }>(ws.api('/settings/domain/verify'), { method: 'POST' });
    setMoved(res.domain);
  });
  const cancel = () => run(async () => {
    await call(ws.api('/settings/domain/pending'), { method: 'DELETE' });
    ws.say('Domain change cancelled'); reload();
  });

  if (moved) {
    const port = window.location.port;
    const url = `${window.location.protocol}//${moved}${port ? `:${port}` : ''}/studio`;
    return (
      <>
        <Head title="Domain" back={back(ws)} />
        <div className="notice success stack-sm">
          <p><b>Your academy now answers at {moved}.</b></p>
          <p>This address stops working for it. Sign in to the studio again at the new one.</p>
          <p><a className="btn primary" href={url}>Open the studio at {moved}</a></p>
        </div>
      </>
    );
  }

  return (
    <>
      <Head title="Domain" back={back(ws)} lead={<>Learners reach your academy at <b>{data.domain}</b>.</>} />
      <Problem error={problem} />
      {data.pending ? (
        <section className="card stack" aria-labelledby="waiting">
          <h2 id="waiting">Waiting to move to {data.pending.domain}</h2>
          <p>Add this TXT record where {data.pending.domain}&apos;s DNS is managed, then check it here. The move happens once the record is found; DNS changes can take a while to appear.</p>
          <div className="stack-sm"><span className="small soft">Name</span><CopyLink link={data.pending.record.name} /></div>
          <div className="stack-sm"><span className="small soft">Value</span><CopyLink link={data.pending.record.value} /></div>
          <div className="actions">
            <button type="button" className="btn" disabled={busy} onClick={() => void cancel()}>Cancel the change</button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void verify()}>Check the TXT record</button>
          </div>
        </section>
      ) : (
        <form className="stack narrow" onSubmit={(e) => { e.preventDefault(); void request(); }}>
          <Field label="New domain" hint="A host name you control, such as learn.example.com. Nothing changes until you prove it with a DNS record.">
            {(p) => <input {...p} className="input" inputMode="url" autoCapitalize="none" spellCheck={false} value={domain} onChange={(e) => setDomain(e.target.value)} />}
          </Field>
          <div className="actions"><button type="submit" className="btn primary" disabled={busy || !domain.trim()}>Request this domain</button></div>
        </form>
      )}
    </>
  );
}

/* ---------- CRM ---------- */

export function CrmPage() {
  const ws = useWorkspace();
  const { data, error, setData } = useLoad<{ url: string | null; secretHint: string | null }>(ws.api('/settings/crm'));
  const [url, setUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [clear, setClear] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  useEffect(() => { if (data && url === null) setUrl(data.url ?? ''); }, [data, url]);
  if (!data || url === null) return <><Head title="CRM endpoint" back={back(ws)} /><Loading error={error} /></>;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    try {
      const body: Record<string, unknown> = { url: url!.trim() || null };
      if (secret) body.secret = secret;
      if (clear) body.clearSecret = true;
      const res = await call<{ url: string | null; secretHint: string | null }>(ws.api('/settings/crm'), { method: 'PUT', body });
      setData(res); setSecret(''); setClear(false);
      ws.say('CRM endpoint saved');
    } catch (err) { ws.handle(err); setProblem(err); }
  }

  return (
    <>
      <Head title="CRM endpoint" back={back(ws)} lead="New leads, verified lessons and certificates are posted here, signed with your secret." />
      <form className="stack narrow" onSubmit={save}>
        <Problem error={problem} />
        <Field label="Endpoint" hint="https only, on a public address. Leave it empty to stop sending.">
          {(p) => <input {...p} className="input" type="url" inputMode="url" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} />}
        </Field>
        <Field label="Signing secret" hint={data.secretHint
          ? `A secret is set, ending in ${data.secretHint}. It is never shown; type a new one to replace it.`
          : 'At least 16 characters. It is never shown again after you save it.'}>
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" minLength={16} value={secret} disabled={clear} onChange={(e) => setSecret(e.target.value)} />}
        </Field>
        {data.secretHint ? (
          <label className="check"><input type="checkbox" checked={clear} onChange={(e) => { setClear(e.target.checked); if (e.target.checked) setSecret(''); }} />Remove the secret: send unsigned</label>
        ) : null}
        <div className="actions"><button type="submit" className="btn primary">Save CRM endpoint</button></div>
      </form>
    </>
  );
}
