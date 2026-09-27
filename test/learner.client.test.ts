/**
 * Module 4b · stage 4. The learner app holds no rule it could disagree
 * with the server about: no answer keys, no baseline formula, no gates,
 * no grading, no invented numbers. It talks only to its own academy's
 * API, draws only with the ten-token contract, and renders lessons with
 * packages/shared. And nothing typed into a brand can reach a page as
 * anything but a colour or a radius.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_TOKENS, sanitiseBrand, tokenStylesheet } from '../packages/shared/brand.js';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}
const files = [...sources('studio/components/learner'), ...sources('studio/app/(learner)')];
const code = files.map((f) => readFileSync(f, 'utf8')).join('\n');
const css = readFileSync('studio/app/(learner)/learner.css', 'utf8');

test('no rule the server owns is computed in the learner app', () => {
  const forbidden: [RegExp, string][] = [
    [/\bbaselineFrom\b|\bcomputeBaseline\b/, 'the baseline formula'],
    [/\blevelFrom\b|\blevelFor\b/, 'level bands'],
    [/\btierUnlocked\b|\bgateReason\s*\(/, 'tier gates'],
    [/correct_key|correctKey\s*[:=]\s*['"]/, 'an answer key'],
    [/\*\s*0?\.[46]0*\b/, 'the 60/40 weighting'],
    [/>=\s*(2|50|70)\b|PASS_THRESHOLD/, 'a pass mark or gate threshold'],
    [/toString\(36\)/, 'a client-generated serial'],
    [/\bcoins?\b/i, 'coins'],
  ];
  for (const [pattern, what] of forbidden) assert.doesNotMatch(code, pattern, `the learner app must not hold ${what}`);
});

test('the learner app talks only to its own academy\'s API', () => {
  assert.doesNotMatch(code, /\bfetch\(/, 'every call goes through the one API client');
  const paths = [...code.matchAll(/call<[^>]*>\(\s*([`'"])([^`'"]*)/g), ...code.matchAll(/call\(\s*([`'"])([^`'"]*)/g)].map((m) => m[2]!);
  assert.ok(paths.length > 10);
  for (const p of paths) assert.match(p, /^\/api\/v1\//, `${p} is on this academy's learner API`);
});

test('the learner app draws with the ten-token contract, and every variable it uses is defined', () => {
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
  for (const { name } of BRAND_TOKENS) assert.ok(defined.has(name), `${name} has a default`);
  // Set on elements by the components themselves, or by next/font.
  const setInline = new Set(['--c', '--dx', '--dy', '--r', '--font-poppins', '--font-nunito']);
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g), ...code.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!));
  assert.deepEqual([...used].filter((v) => !defined.has(v) && !setInline.has(v)), [], 'no variable is used without a definition');
  assert.doesNotMatch(code + css, /data-theme|data-mode/, 'a dark academy is a token set, not a theme or a mode');
});

test('lessons are rendered with packages/shared, in the learner app and in the studio\'s preview alike', () => {
  for (const f of ['studio/components/learner/pages/Lesson.tsx', 'studio/components/LessonPreview.tsx']) {
    assert.match(readFileSync(f, 'utf8'), /import \{ inline, parseLesson \} from '[./]+packages\/shared\/markdown'/, f);
  }
  assert.doesNotMatch(code, /function (parseLesson|inline)\b/, 'no copy of the renderer');
});

test('nothing in a brand can reach a page as markup', () => {
  const hostile = {
    '--brand': 'red;}</style><script>alert(2)</script>',
    '--evil': '#000000',
    '--radius': '10px;background:url(https://tracker.example)',
    '--ink-soft': '#5D6D8580',
    '--accent': '#FFFFFF',
  };
  assert.equal(tokenStylesheet(hostile), ':root{--accent:#FFFFFF}', 'only the well-formed, known token survives');
  assert.equal(tokenStylesheet('not tokens'), '');
});

test('the brand sanitiser keeps known tokens with valid values and reports the rest', () => {
  const b = sanitiseBrand({ sub: 'Ok', tokens: { '--brand': '#abc', '--radius': '7px', '--surface': 'blue', '--r-s': '7px', '--x': '#fff' } });
  assert.deepEqual(b.tokens, { '--brand': '#abc', '--radius': '7px' });
  assert.deepEqual(b.refused.sort(), ['--r-s', '--surface', '--x'], 'legacy names, bad values and unknown names are all refused');
  assert.deepEqual(sanitiseBrand('not an object'), { sub: '', tokens: {}, refused: [] });
});
