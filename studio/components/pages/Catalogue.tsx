'use client';
/**
 * Which published courses this academy's learners are offered, and in
 * what order. Each switch saves as it is flipped.
 */
import { useState } from 'react';
import { call } from '@/lib/api';
import type { Tier } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Head, Loading, TierChip } from '../bits';
import { Problem } from '../Form';
import { Icon } from '../Icon';
import { useWorkspace } from '../Workspace';

interface Entry { courseId: string; title: string; tier: Tier; source: 'platform' | 'academy'; enabled: boolean; position: number; lessons: number }

function Row({ c, i, count, busy, onToggle, onMove }: {
  c: Entry; i?: number; count: number; busy: boolean; onToggle(c: Entry): void; onMove(i: number, by: -1 | 1): void;
}) {
  return (
    <li className="item">
      <span className="grow">
        <span className="title">{c.title}</span>
        <span className="row tight">
          <TierChip tier={c.tier} />
          <span className="soft small">{c.source === 'platform' ? 'Platform course' : 'Your academy'}, {c.lessons} lessons</span>
        </span>
      </span>
      {i !== undefined ? (
        <span className="row tight">
          <button type="button" id={`up-${c.courseId}`} className="btn ghost" aria-label={`Move ${c.title} up`} disabled={i === 0} aria-disabled={busy} onClick={() => !busy && onMove(i, -1)}><Icon name="arrowUp" /></button>
          <button type="button" id={`down-${c.courseId}`} className="btn ghost" aria-label={`Move ${c.title} down`} disabled={i === count - 1} aria-disabled={busy} onClick={() => !busy && onMove(i, 1)}><Icon name="arrowDown" /></button>
        </span>
      ) : null}
      <span className="switch-hit">
        <button type="button" role="switch" id={`offer-${c.courseId}`} className="switch" aria-checked={c.enabled} aria-label={`Offer ${c.title} to learners`}
          aria-disabled={busy} onClick={() => !busy && onToggle(c)} />
      </span>
    </li>
  );
}

export function CataloguePage() {
  const ws = useWorkspace();
  const { data, error, setData } = useLoad<{ courses: Entry[] }>(ws.api('/catalogue'));
  const [problem, setProblem] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (!data) return <><Head title="Catalogue" /><Loading error={error} /></>;
  const offered = data.courses.filter((c) => c.enabled).sort((a, b) => a.position - b.position);
  const hidden = data.courses.filter((c) => !c.enabled);

  async function put(changes: Entry[]) {
    setBusy(true);
    setProblem(null);
    try {
      for (const c of changes) {
        await call(ws.api(`/catalogue/${c.courseId}`), { method: 'PUT', body: { enabled: c.enabled, position: c.position } });
      }
      const byId = new Map(changes.map((c) => [c.courseId, c]));
      setData({ courses: data!.courses.map((c) => byId.get(c.courseId) ?? c) });
      return true;
    } catch (err) {
      ws.handle(err);
      setProblem(err);
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Numbers the offered courses 1, 2, 3 in the given order, saving only those that moved. */
  const renumber = (order: Entry[]) => order.map((c, i) => ({ ...c, position: i + 1 })).filter((c, i) => order[i]!.position !== c.position);

  /** A row moves between lists when it changes; keep the keyboard on the control that moved it. */
  const refocus = (id: string) => setTimeout(() => document.getElementById(id)?.focus(), 0);

  async function toggle(c: Entry) {
    const on = !c.enabled;
    const ok = await put([{ ...c, enabled: on, position: on ? offered.length + 1 : c.position }]);
    if (ok) {
      ws.say(on ? `${c.title} is offered to learners` : `${c.title} is hidden from learners`);
      refocus(`offer-${c.courseId}`);
    }
  }

  async function move(i: number, by: -1 | 1) {
    const order = [...offered];
    const [c] = order.splice(i, 1);
    order.splice(i + by, 0, c!);
    if (await put(renumber(order))) {
      const edge = (by === -1 && i + by === 0) || (by === 1 && i + by === order.length - 1);
      refocus(`${edge ? (by === -1 ? 'down' : 'up') : by === -1 ? 'up' : 'down'}-${c!.courseId}`);
    }
  }

  return (
    <>
      <Head title="Catalogue" lead="The courses your learners are offered, in the order they see them. Only published courses can be offered." />
      <Problem error={problem} />
      <section aria-labelledby="offered">
        <h2 id="offered">Offered to learners</h2>
        {offered.length ? <ol className="list">{offered.map((c, i) => <Row key={c.courseId} c={c} i={i} count={offered.length} busy={busy} onToggle={(x) => void toggle(x)} onMove={(x, by) => void move(x, by)} />)}</ol>
          : <div className="card empty"><p>No courses are offered. Switch one on below and learners see it on their path.</p></div>}
      </section>
      {hidden.length ? (
        <section aria-labelledby="hidden">
          <h2 id="hidden">Not offered</h2>
          <ul className="list">{hidden.map((c) => <Row key={c.courseId} c={c} count={offered.length} busy={busy} onToggle={(x) => void toggle(x)} onMove={(x, by) => void move(x, by)} />)}</ul>
        </section>
      ) : null}
    </>
  );
}
