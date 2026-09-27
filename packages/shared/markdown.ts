/**
 * The lesson Markdown subset. One implementation, used by the API to
 * check a lesson before it is sent for review, and by the studio to show
 * the author exactly what a learner will read.
 *
 *   ## Heading            a lesson step; the lines after it are its text
 *   > **In practice**     the callout; its lines start with "> "
 *   **bold**              bold
 *   [[term|definition]]   a glossary term
 *
 * Every piece of text is escaped. Nothing from a lesson is ever inserted
 * as markup. The learner app renders lessons with these functions, and
 * the studio's preview does too, so an author sees what a learner reads.
 */

export interface LessonStep {
  h: string;
  p: string;
}

export interface LessonDoc {
  steps: LessonStep[];
  callout: LessonStep | null;
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const INLINE = /\*\*([^*]+)\*\*|\[\[([^\]|]+)\|([^\]]+)\]\]/g;

/** One paragraph of text to HTML: bold and glossary terms, all else escaped. */
export function inline(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    out += escapeHtml(text.slice(last, m.index));
    out += m[1] !== undefined
      ? `<b>${escapeHtml(m[1])}</b>`
      : `<span class="term" data-def="${escapeHtml(m[3])}">${escapeHtml(m[2])}</span>`;
    last = m.index! + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

export function parseLesson(md: string): LessonDoc {
  const steps: LessonStep[] = [];
  let callout: LessonStep | null = null;
  for (const block of String(md || '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const first = lines[0]!;
    if (first.startsWith('## ')) {
      steps.push({ h: first.slice(3), p: lines.slice(1).join(' ') });
    } else if (first.startsWith('> ')) {
      const body = lines.map((l) => l.replace(/^>\s?/, ''));
      const title = /^\*\*(.+)\*\*$/.exec(body[0]!);
      callout = title ? { h: title[1]!, p: body.slice(1).join(' ') } : { h: 'Note', p: body.join(' ') };
    } else if (steps.length) {
      steps[steps.length - 1]!.p += ' ' + lines.join(' ');
    }
  }
  return { steps, callout };
}

/** Problems an author must fix before a lesson can be sent for review. Empty means fine. */
export function lessonProblems(md: string): string[] {
  const problems: string[] = [];
  const doc = parseLesson(md);
  if (doc.steps.length === 0) problems.push('Add at least one step, starting with "## ".');
  doc.steps.forEach((s, i) => {
    if (!s.h.trim()) problems.push(`Step ${i + 1} needs a heading.`);
    if (!s.p.trim()) problems.push(`Step ${i + 1} ("${s.h}") needs some text.`);
  });
  const opened = (md.match(/\[\[/g) ?? []).length;
  const wellFormed = (md.match(/\[\[[^\]|]+\|[^\]]+\]\]/g) ?? []).length;
  if (opened !== wellFormed) problems.push('Write every glossary term as [[term|definition]].');
  if (/^#(?!# )/m.test(md) || /^###/m.test(md)) problems.push('Use "## " for steps; other heading levels are not shown.');
  return problems;
}
