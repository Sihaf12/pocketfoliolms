'use client';
/**
 * Events on their way to a CRM: how the queue is doing, and a way to send
 * again an event that ran out of attempts. The studio sees its academy's;
 * the console, every academy's. Event contents are never shown.
 */
import { useState } from 'react';
import { call } from '@/lib/api';
import { day, plural, waited } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Head, Loading } from '../bits';
import { Problem } from '../Form';
import { useWorkspace } from '../Workspace';

interface Health {
  counts: { pending: number; in_flight: number; delivered: number; failed: number; dead: number };
  oldestPendingAt: string | null;
  dead: { id: string; academy: string; eventType: string; retryCount: number; lastError: string | null; createdAt: string }[];
}

export function DeliveriesPage() {
  const ws = useWorkspace();
  const { data, error, reload } = useLoad<Health>(ws.api('/outbox'));
  const [problem, setProblem] = useState<unknown>(null);
  const [sending, setSending] = useState<string | null>(null);
  const console = ws.kind === 'console';

  async function replay(id: string) {
    setSending(id); setProblem(null);
    try {
      await call(ws.api(`/outbox/${id}/replay`), { method: 'POST' });
      ws.say('Sent back to the queue');
      reload();
    } catch (err) { ws.handle(err); setProblem(err); } finally { setSending(null); }
  }

  const head = <Head title="Deliveries" back={console ? undefined : { href: ws.href('/settings'), label: 'Settings' }}
    lead={console ? 'Events on their way to every academy\'s CRM.' : 'Events on their way to your CRM.'} />;
  if (!data) return <>{head}<Loading error={error} /></>;
  const c = data.counts;
  const waiting = c.pending + c.in_flight + c.failed;

  return (
    <>
      {head}
      <Problem error={problem} />
      <section aria-labelledby="queue">
        <h2 id="queue">The queue</h2>
        <div className="card stack-sm">
          <p><span className="num">{c.delivered.toLocaleString('en-GB')}</span> delivered.</p>
          <p>{waiting
            ? <><span className="num">{waiting}</span> waiting{data.oldestPendingAt ? `, the oldest for ${waited(data.oldestPendingAt)}` : ''}{c.failed ? `; ${c.failed} of them being retried` : ''}.</>
            : 'Nothing waiting.'}</p>
          <p>{c.dead ? <><span className="num">{c.dead}</span> stopped after every attempt failed.</> : 'Nothing has failed for good.'}</p>
        </div>
      </section>
      <section aria-labelledby="failed">
        <h2 id="failed">Stopped after every attempt</h2>
        {data.dead.length ? (
          <ul className="list">
            {data.dead.map((d) => (
              <li className="item" key={d.id}>
                <span className="grow">
                  <span className="title">{d.eventType}{console ? `, ${d.academy}` : ''}</span>
                  <span className="soft small">{day(d.createdAt)}, {plural(d.retryCount, 'attempt')}.</span>
                  {d.lastError ? <span className="mono small error-text">{d.lastError}</span> : null}
                </span>
                <button type="button" className="btn" disabled={sending === d.id} onClick={() => void replay(d.id)}>
                  Send again<span className="visually-hidden">: {d.eventType} from {day(d.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <div className="card"><p>None. Every event either arrived or is still being tried.</p></div>}
      </section>
    </>
  );
}
