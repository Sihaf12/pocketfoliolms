'use client';
/**
 * The platform glossary, edited on the console only. A term goes through
 * the same review as a lesson; learners meet it inside lessons, where
 * authors write [[term|definition]].
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/api';
import type { GlossarySnapshot, Version, VersionView as View } from '@/lib/content';
import { moment, type ReviewState } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Head, Loading, StateChip } from '../bits';
import { ErrorScope, Field } from '../Form';
import { Icon } from '../Icon';
import { VersionActions } from '../VersionActions';
import { useWorkspace } from '../Workspace';
import { VersionScreen } from './Version';

interface Term { id: string; term: string; definition: string }
interface InProgress { id: string; versionId: string; term: string; state: ReviewState }

export function GlossaryPage() {
  const ws = useWorkspace();
  const { data, error } = useLoad<{ terms: Term[]; inProgress?: InProgress[] }>(ws.content('/glossary'));
  const add = ws.has('author') ? <Link className="btn primary" href={ws.href('/glossary/new')}><Icon name="plus" />Add a term</Link> : null;
  if (!data) return <><Head title="Glossary" /><Loading error={error} /></>;
  const busy = data.inProgress ?? [];
  return (
    <>
      <Head title="Glossary" lead="Terms every academy's lessons can define. A new or changed term reaches learners once compliance publishes it.">{add}</Head>
      {busy.length ? (
        <section aria-labelledby="in-progress">
          <h2 id="in-progress">Being written or reviewed</h2>
          <ul className="list">
            {busy.map((t) => (
              <li key={t.id}>
                <Link className="item" href={ws.href(`/glossary/${t.id}`)}>
                  <span className="grow"><span className="title">{t.term}</span></span><StateChip state={t.state} /><Icon name="next" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="live">
        <h2 id="live">In the glossary</h2>
        {data.terms.length ? (
          <ul className="list">
            {data.terms.map((t) => (
              <li key={t.id}>
                <Link className="item" href={ws.href(`/glossary/${t.id}`)}>
                  <span className="grow"><span className="title">{t.term}</span><span className="soft small">{t.definition}</span></span><Icon name="next" />
                </Link>
              </li>
            ))}
          </ul>
        ) : <div className="card empty"><p>No terms yet.</p>{add}</div>}
      </section>
    </>
  );
}

function TermFields({ value, onChange }: { value: GlossarySnapshot; onChange(v: GlossarySnapshot): void }) {
  return (
    <>
      <Field label="Term" name="term">{(p) => <input {...p} className="input" maxLength={80} value={value.term} onChange={(e) => onChange({ ...value, term: e.target.value })} />}</Field>
      <Field label="Definition" name="definition" hint="One or two plain sentences. This is what a learner sees beside the term.">
        {(p) => <textarea {...p} className="textarea short-text" maxLength={600} value={value.definition} onChange={(e) => onChange({ ...value, definition: e.target.value })} />}
      </Field>
      <Field label="Related terms" name="related" hint="Separate them with commas.">
        {(p) => <input {...p} className="input" value={value.related.join(', ')}
          onChange={(e) => onChange({ ...value, related: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />}
      </Field>
    </>
  );
}

export function NewTermPage() {
  const ws = useWorkspace();
  const router = useRouter();
  const [value, setValue] = useState<GlossarySnapshot>({ term: '', definition: '', related: [] });
  const [problem, setProblem] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setProblem(null);
    try {
      const res = await call<{ version: Version }>(ws.content('/glossary'), { method: 'POST', body: value });
      ws.say('Term draft created');
      router.replace(ws.href(`/glossary/${res.version.entityId}`));
    } catch (err) { ws.handle(err); setProblem(err); setBusy(false); }
  }
  return (
    <>
      <Head title="Add a term" back={{ href: ws.href('/glossary'), label: 'Glossary' }} />
      <form className="stack narrow" onSubmit={create}>
        <ErrorScope error={problem}>
        <TermFields value={value} onChange={setValue} />
        <div className="actions"><button type="submit" className="btn primary" disabled={busy || !value.term.trim() || !value.definition.trim()}>Create term draft</button></div>
        </ErrorScope>
      </form>
    </>
  );
}

export function TermPage({ termId }: { termId: string }) {
  const ws = useWorkspace();
  const history = useLoad<{ versions: Version<GlossarySnapshot>[] }>(ws.content(`/entities/glossary_term/${termId}/versions`));
  const latest = history.data?.versions[0];
  const view = useLoad<View<GlossarySnapshot>>(latest ? ws.content(`/versions/${latest.id}`) : null);
  const reload = () => { history.reload(); view.reload(); };
  if (history.data && !latest) return <><Head title="Term" /><p>No such term.</p></>;
  if (!latest || !view.data || view.data.version.id !== latest.id) return <><Head title="Term" /><Loading error={history.error ?? view.error} /></>;
  if (latest.state === 'draft' && ws.has('author')) return <TermEditor key={latest.id} version={latest} actions={view.data.actions} onChanged={reload} />;
  return <VersionScreen view={view.data} onChanged={reload} />;
}

function TermEditor({ version, actions, onChanged }: { version: Version<GlossarySnapshot>; actions: View['actions']; onChanged(): void }) {
  const ws = useWorkspace();
  const [value, setValue] = useState(version.snapshot);
  const [saved, setSaved] = useState(JSON.stringify(version.snapshot));
  const [problem, setProblem] = useState<unknown>(null);
  const dirty = JSON.stringify(value) !== saved;
  async function save(): Promise<boolean> {
    if (!dirty) return true;
    setProblem(null);
    try {
      const res = await call<{ version: Version<GlossarySnapshot> }>(ws.content(`/glossary/${version.entityId}/draft`), { method: 'PUT', body: value });
      setSaved(JSON.stringify(res.version.snapshot));
      return true;
    } catch (err) { ws.handle(err); setProblem(err); return false; }
  }
  return (
    <>
      <Head title={value.term || 'Term'} back={{ href: ws.href('/glossary'), label: 'Glossary' }}
        lead={<span className="row tight"><StateChip state={version.state} /><span>Version {version.number}</span></span>} />
      <div className="stack narrow">
        <ErrorScope error={problem}>
        <TermFields value={value} onChange={setValue} />
        </ErrorScope>
      </div>
      <VersionActions versionId={version.id} entityId={version.entityId} entityType="glossary_term" actions={actions.filter((a) => a === 'submit')}
        status={dirty ? 'Unsaved changes.' : `Saved ${moment(version.createdAt)}.`} before={save} onDone={() => onChanged()} onError={(err) => { ws.handle(err); setProblem(err); }}
        secondary={<button type="button" className="btn" disabled={!dirty} onClick={() => void save().then((ok) => ok && ws.say('Draft saved'))}>Save draft</button>} />
    </>
  );
}
