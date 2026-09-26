'use client';
/**
 * Public certificate verification: no account, no app around it. It shows
 * the holder's name, the course and the date, and nothing else; a revoked
 * or unknown code reads the same, as the API answers them the same.
 */
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ApiError, call } from '@/lib/api';
import { MarkIcon, Tick } from '../icons';
import { SkipLink } from '../Shell';
import { useAcademy } from '../context';
import { CertificateCard } from './Progress';

interface Record { holderName: string; courseTitle: string; issuedAt: string }
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const SERIAL = /^PA-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function VerifyPage() {
  const params = useParams<{ serial?: string }>();
  const serial = params.serial ? decodeURIComponent(params.serial).toUpperCase() : null;
  const router = useRouter();
  const academy = useAcademy();
  const [record, setRecord] = useState<Record | null | undefined>(serial ? undefined : null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!serial) return;
    call<Record>(`/api/v1/certificates/${encodeURIComponent(serial)}`).then(setRecord).catch((err: unknown) => {
      setRecord(err instanceof ApiError && err.status === 404 ? null : null);
    });
  }, [serial]);

  function check(e: React.FormEvent) {
    e.preventDefault();
    const v = code.trim().toUpperCase();
    if (!v) { setMessage('Enter the code printed on the certificate.'); return; }
    if (!SERIAL.test(v)) { setMessage(`${v} is not a certificate code. Codes look like PA-7K3M-9QXD.`); return; }
    if (v === serial) { setMessage(record ? 'That is the certificate shown above. It is valid.' : 'That is the code checked above.'); return; }
    router.push(`/verify/${v}`);
  }

  return (
    <div className="screen">
      <SkipLink />
      <header className="vhead"><div className="wrap"><i aria-hidden="true"><MarkIcon /></i><span>Certificate record, checked at {academy.name}</span></div></header>
      <main id="main" className="verify"><div className="wrap"><div className="box stag">
        {serial === null ? (
          <div className="vmark"><div><h1>Check a certificate</h1><small>Enter the code printed on it. No account is needed.</small></div></div>
        ) : record === undefined ? (
          <div className="vmark"><div><h1>Checking {serial}…</h1></div></div>
        ) : record ? (
          <>
            <div className="vmark">
              <span className="seal" aria-hidden="true"><Tick /></span>
              <div><h1>Valid certificate</h1><small>Issued and recorded. Not revoked.</small></div>
            </div>
            <CertificateCard holder={record.holderName} course={record.courseTitle} serial={serial} issuedAt={record.issuedAt} />
            <dl className="vrec">
              <div><dt>Serial</dt><dd><code>{serial}</code></dd></div>
              <div><dt>Issued</dt><dd>{dateFormat.format(new Date(record.issuedAt))}</dd></div>
            </dl>
            <p className="note">This page needs no account. It shows the holder&apos;s name, the course and the date, and nothing else. A revoked certificate does not show as valid.</p>
          </>
        ) : (
          <div className="vmark">
            <span className="seal none" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 8v5M12 16h.01" /></svg></span>
            <div><h1>No valid certificate has this code</h1><small>{serial} does not match a certificate that is valid today. Check the code on the certificate and try again.</small></div>
          </div>
        )}
        <form className="vcheck" onSubmit={check} noValidate>
          <label htmlFor="vcode">{serial ? 'Check another code' : 'Certificate code'}</label>
          <input id="vcode" placeholder="PA-XXXX-XXXX" autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn" type="submit">Check</button>
        </form>
        <p className="vmsg" role="status">{message}</p>
      </div></div></main>
    </div>
  );
}
