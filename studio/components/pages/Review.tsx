'use client';
/** What is waiting for this person: expert review for reviewers, compliance review for compliance. */
import Link from 'next/link';
import type { EntityKind } from '@/lib/content';
import { waited, type ReviewState } from '@/lib/format';
import { useLoad } from '@/lib/useLoad';
import { Head, Loading, StateChip } from '../bits';
import { Icon } from '../Icon';
import { useWorkspace } from '../Workspace';

interface Item {
  versionId: string;
  entityType: EntityKind;
  number: number;
  state: ReviewState;
  title: string;
  submittedBy: string | null;
  submittedAt: string | null;
}

const KIND: Record<EntityKind, string> = { course: 'Course', lesson: 'Lesson', glossary_term: 'Glossary term' };

export function ReviewPage() {
  const ws = useWorkspace();
  const { data, error } = useLoad<{ items: Item[] }>(ws.content('/review/queue'));
  const reviews = ws.has('reviewer') || ws.has('compliance');
  const lead = [ws.has('reviewer') ? 'expert review' : null, ws.has('compliance') ? 'compliance review' : null].filter(Boolean).join(' and ');

  return (
    <>
      <Head title="Review" lead={reviews ? `Work waiting for ${lead}, oldest first.` : 'Reviewers and compliance see what is waiting for them here.'} />
      {!data ? <Loading error={error} /> : data.items.length ? (
        <ul className="list">
          {data.items.map((i) => (
            <li key={i.versionId}>
              <Link className="item" href={ws.href(`/versions/${i.versionId}`)}>
                <span className="grow">
                  <span className="title">{i.title}</span>
                  <span className="soft small">
                    {KIND[i.entityType]}, version {i.number}. Sent by {i.submittedBy ?? 'an author'}{i.submittedAt ? `, waiting ${waited(i.submittedAt)}` : ''}.
                  </span>
                </span>
                <StateChip state={i.state} />
                <Icon name="next" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card empty">
          <p>{reviews
            ? 'Nothing is waiting for you. New work appears here when an author sends it for review.'
            : 'Your roles do not include reviewing. What you send for review appears here for the people who do.'}</p>
          <Link className="btn" href={ws.href('/')}>See the content</Link>
        </div>
      )}
    </>
  );
}
