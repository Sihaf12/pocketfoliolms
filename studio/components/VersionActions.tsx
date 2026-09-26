'use client';
/**
 * The workflow buttons for one version: what this person may do with it
 * now, as the API worked it out. One of them leads. Sending back always
 * asks for notes; withdrawing a course asks to be sure.
 */
import { useRef, useState } from 'react';
import { call } from '@/lib/api';
import type { Version } from '@/lib/content';
import { ACTION_LABEL, ACTION_ORDER, type Action } from '@/lib/format';
import { ErrorScope, Field, Problem } from './Form';
import { useWorkspace } from './Workspace';

export function VersionActions({ versionId, entityId, entityType, actions, status, before, secondary, onDone, onError }: {
  versionId: string;
  entityId: string;
  entityType: string;
  actions: Action[];
  /** A sentence about where things stand, beside the buttons. */
  status?: React.ReactNode;
  /** Runs first, such as saving unsaved changes before sending for review. */
  before?: () => Promise<boolean>;
  /** Other buttons for the bar, such as saving a draft. Never a second primary. */
  secondary?: React.ReactNode;
  onDone(version: Version, action: Action): void;
  /** Where refusals go when the page shows them in its own form. Otherwise they show here. */
  onError?(err: unknown): void;
}) {
  const ws = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notes, setNotes] = useState('');
  const rejectDialog = useRef<HTMLDialogElement>(null);
  const retireDialog = useRef<HTMLDialogElement>(null);

  const ordered = ACTION_ORDER.filter((a) => actions.includes(a));
  const lead = ordered.find((a) => a !== 'reject' && a !== 'retire');

  async function run(action: Action) {
    setBusy(true);
    setError(null);
    try {
      if (before && !(await before())) { setBusy(false); return; }
      const path = action === 'retire' ? `/entities/${entityType}/${entityId}/retire` : `/versions/${versionId}/${action}`;
      const res = await call<{ version: Version }>(ws.content(path), {
        method: 'POST', body: action === 'reject' ? { notes } : undefined,
      });
      rejectDialog.current?.close();
      retireDialog.current?.close();
      setNotes('');
      ws.say(DONE[action]);
      onDone(res.version, action);
    } catch (err) {
      // A refused note stays in its dialog; anything else goes to the page's form if it has one.
      if (onError && !(action === 'reject' && rejectDialog.current?.open)) onError(err);
      else { ws.handle(err); setError(err); }
    } finally {
      setBusy(false);
    }
  }

  if (!ordered.length && !status && !secondary) return null;
  return (
    <>
      {rejectDialog.current?.open ? null : <Problem error={error} />}
      <div className="actions">
        {status ? <p className="status">{status}</p> : null}
        {secondary}
        {ordered.filter((a) => a !== lead).map((a) => (
          <button key={a} type="button" className="btn" disabled={busy}
            onClick={() => (a === 'reject' ? rejectDialog.current?.showModal() : a === 'retire' ? retireDialog.current?.showModal() : void run(a))}>
            {ACTION_LABEL[a]}
          </button>
        ))}
        {lead ? <button type="button" className="btn primary" disabled={busy} onClick={() => void run(lead)}>{ACTION_LABEL[lead]}</button> : null}
      </div>

      <dialog className="sheet" ref={rejectDialog} aria-labelledby={`reject-${versionId}`}>
        <form method="dialog" className="stack" onSubmit={(e) => { e.preventDefault(); void run('reject'); }}>
          <h2 id={`reject-${versionId}`}>Send back with notes</h2>
          <p className="soft">The author sees these notes and starts a revision from them. Say what to change and why.</p>
          <ErrorScope error={rejectDialog.current?.open ? error : null}>
            <Field label="Notes for the author" name="notes">
              {(p) => <textarea {...p} className="textarea" required maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />}
            </Field>
          </ErrorScope>
          <div className="row end">
            <button type="button" className="btn" onClick={() => rejectDialog.current?.close()}>Keep reviewing</button>
            <button type="submit" className="btn primary" disabled={busy || !notes.trim()}>Send back with notes</button>
          </div>
        </form>
      </dialog>

      <dialog className="sheet" ref={retireDialog} aria-labelledby={`retire-${versionId}`}>
        <div className="stack">
          <h2 id={`retire-${versionId}`}>Withdraw this course?</h2>
          <p className="soft">It leaves every learner&apos;s path at once. Progress and certificates already earned are kept.</p>
          <div className="row end">
            <button type="button" className="btn" onClick={() => retireDialog.current?.close()}>Keep it published</button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void run('retire')}>Withdraw course</button>
          </div>
        </div>
      </dialog>
    </>
  );
}

const DONE: Record<Action, string> = {
  submit: 'Sent for review',
  approve: 'Approved. It is with compliance now.',
  reject: 'Sent back to the author',
  publish: 'Published',
  retire: 'Withdrawn from every path',
  revise: 'A new draft is open',
};
