'use client';
/**
 * What a publish did, said once it is done. Published is not the same as
 * seen by learners: a course has to be switched on in the catalogue, and
 * a lesson reaches learners only through a published course that is on.
 * Whoever can take the next step gets a link to it.
 */
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import type { CourseDetail, EntityKind } from '@/lib/content';
import { useWorkspace } from './Workspace';

export function AfterPublish({ kind, course }: { kind: EntityKind; course?: CourseDetail | null }) {
  const ws = useWorkspace();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.focus(); }, []);

  const catalogue = ws.isAdmin && ws.kind === 'studio'
    ? <p><Link href={ws.href('/catalogue')}>Turn it on in the catalogue</Link></p>
    : null;
  let tone = 'success';
  let body: React.ReactNode;

  if (kind === 'glossary_term') {
    body = <p>Lessons that use this term show its new definition now.</p>;
  } else if (kind === 'course' && ws.kind === 'console') {
    body = <p>Each academy allowed this course sees it in its catalogue, switched off until its admin turns it on.</p>;
  } else if (kind === 'course') {
    body = course?.course.offered
      ? <p>It is on in the catalogue, so learners see this version now.</p>
      : <><p>Switched off in the catalogue until an admin turns it on. Until then, no learner sees it.</p>{catalogue}</>;
    if (!course?.course.offered) tone = 'caution';
  } else if (course && course.course.liveState !== 'published') {
    tone = 'caution';
    body = (
      <>
        <p>Its course, {course.course.title}, is still a draft. Nothing in it reaches learners until the course itself is published.</p>
        <p><Link href={ws.href(`/courses/${course.course.id}#where`)}>Go to the course and where it stands</Link></p>
      </>
    );
  } else if (ws.kind === 'studio' && course && !course.course.offered) {
    tone = 'caution';
    body = (
      <>
        <p>Its course, {course.course.title}, is switched off in the catalogue, so learners see it once an admin turns the course on.</p>
        {catalogue}
      </>
    );
  } else {
    body = <p>Learners taking {course?.course.title ?? 'its course'} see it now.</p>;
  }

  return (
    <div className={`notice ${tone}`} role="status" tabIndex={-1} ref={box}>
      <p><b>{tone === 'success' ? 'Published.' : 'Published, but not yet seen by learners.'}</b></p>
      {body}
    </div>
  );
}
