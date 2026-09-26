'use client';
/**
 * A link or value the person has to take away, often shown only once.
 *
 * It sits in a read-only field that selects all of itself on a tap, so it
 * can always be copied by hand. The Copy button is offered only where the
 * browser has a clipboard (https, or localhost); if copying still fails,
 * that is said, and the value stays on screen, selected.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';

export function OneTimeLink({ label, value }: { label: string; value: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [canCopy, setCanCopy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  // Known only in the browser, so decided after the first render.
  useEffect(() => { setCanCopy(typeof navigator !== 'undefined' && !!navigator.clipboard); }, []);

  const selectAll = () => input.current?.setSelectionRange(0, value.length);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setSaid({ ok: true, text: 'Copied.' });
    } catch {
      input.current?.focus();
      selectAll();
      setSaid({ ok: false, text: 'Could not copy it. It is selected: copy it with your keyboard or the menu.' });
    }
  }

  return (
    <div className="stack-sm">
      <label className="small soft" htmlFor={id}>{label}</label>
      <div className="copy">
        <input ref={input} id={id} className="input mono" readOnly value={value} spellCheck={false}
          onFocus={selectAll} onClick={selectAll} />
        {canCopy ? <button type="button" className="btn" onClick={() => void copy()}><Icon name="copy" />Copy</button> : null}
      </div>
      <p className={`small ${said && !said.ok ? 'error' : 'soft'}`} aria-live="polite">{said?.text ?? ''}</p>
    </div>
  );
}
