/**
 * The demo seed's content document, read straight from db/seed/demo.sql,
 * so tests check the curriculum and brands the demo actually loads.
 */
import { readFileSync } from 'node:fs';

export interface DemoDocument {
  academies: { slug: string; brand: { sub: string; tokens: Record<string, string> } }[];
  lessons: { code: string; body: string }[];
}

export function demoDocument(): DemoDocument {
  const sql = readFileSync('db/seed/demo.sql', 'utf8');
  const start = sql.indexOf('$demo$\n') + '$demo$\n'.length;
  return JSON.parse(sql.slice(start, sql.indexOf('\n$demo$);'))) as DemoDocument;
}
