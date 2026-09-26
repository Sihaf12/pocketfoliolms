/**
 * Demo wiring · stage 5. The client holds no rule it could disagree with
 * the server about: no answer keys, no baseline formula, no gates, no
 * grading, no invented numbers. If one comes back, this fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import { BRAND_TOKENS } from '../packages/shared/brand.js';
import { inline, parseLesson } from '../packages/shared/markdown.js';
import { demoDocument } from './demoContent.js';

const page = readFileSync('web/index.html', 'utf8');
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);

test('the client script parses', () => {
  assert.equal(scripts.length, 1, 'one inline script');
  assert.doesNotThrow(() => new Script(scripts[0]!), 'the client is valid JavaScript');
});

test('no rule the server owns is computed in the browser', () => {
  const code = scripts.join('\n');
  const forbidden: [RegExp, string][] = [
    [/\bcomputeBaseline\b/, 'the baseline formula'],
    [/\blevelFor\b/, 'level bands'],
    [/\btierUnlocked\b|\btierGateText\b/, 'tier gates'],
    [/\bnodeState\b|\bnodeGate\b|\bnextNode\b/, 'lesson states and prerequisites'],
    [/\b(PLACEMENT|CHECKS|NODES|LESSONS)\s*=/, 'a local question bank or curriculum'],
    [/\ba\s*:\s*\d\b|correct_key/, 'an answer key'],
    [/\*\s*0?\.[46]0*\b/, 'the 60/40 weighting'],
    [/>=\s*(2|50|70)\b/, 'a pass mark or gate threshold'],
    [/\bemit\s*\(/, 'client-invented events'],
    [/toString\(36\)/, 'a client-generated serial'],
    [/\bcoins?\b/i, 'coins'],
  ];
  for (const [pattern, what] of forbidden) {
    assert.doesNotMatch(code, pattern, `the client must not hold ${what}`);
  }
});

test('the client talks only to its own academy API', () => {
  const code = scripts.join('\n');
  const fetches = [...code.matchAll(/fetch\(([^,)]+)/g)].map((m) => m[1]!.trim());
  assert.deepEqual(fetches, ["'/api/v1'+path"], 'one fetch, relative to /api/v1');
});

test('branding comes from the server, not from themes in the page', () => {
  assert.doesNotMatch(page, /data-theme|data-mode/, 'a dark academy is a token set, not a theme or a mode');
  assert.match(page, /<\/head>/, 'the head the server injects the academy into');
  assert.match(page, /document\.getElementById\('academy'\)/, 'the academy is read from the injected block');
});

test('the page uses the ten-token contract, and every variable it uses is defined', () => {
  const root = page.slice(page.indexOf(':root{'), page.indexOf('}', page.indexOf(':root{')));
  const defined = new Set([...root.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]!));
  for (const { name } of BRAND_TOKENS) assert.ok(defined.has(name), `${name} has a default`);
  const used = new Set([...page.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!));
  assert.deepEqual([...used].filter((v) => !defined.has(v)), [], 'no variable is used without a definition');
  for (const legacy of ['--bg', '--muted', '--brandtext', '--r', '--r-s', '--r-l', '--ok', '--warn', '--bad']) {
    assert.doesNotMatch(page, new RegExp(`${legacy}(?![\\w-])`), `${legacy} is gone`);
  }
});

/** The page script, run in a sandbox with a do-nothing DOM, so its functions can be called. */
function sandboxedClient(): Record<string, unknown> {
  const inert: object = new Proxy(function inertFn() {}, {
    get: (_t, key) => (key === Symbol.toPrimitive ? () => '' : inert),
    set: () => true,
    apply: () => inert,
  });
  const context = createContext({
    document: inert, navigator: inert, getComputedStyle: inert,
    location: { search: '', host: 'test.example', origin: 'http://test.example' },
    URLSearchParams, JSON, Math, Date, console,
    fetch: () => Promise.reject(Object.assign(new Error('offline'), { status: 401 })),
    setTimeout: () => 0, clearTimeout: () => undefined, addEventListener: () => undefined,
    requestAnimationFrame: () => 0,
  });
  new Script(scripts[0]!).runInContext(context);
  return context as Record<string, unknown>;
}

test('the page renders lessons exactly as packages/shared does', () => {
  const client = sandboxedClient();
  const clientParse = client.parseLesson as (md: string) => unknown;
  const clientInline = client.inline as (text: string) => string;
  const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
  const bodies = demoDocument().lessons.map((l) => l.body).concat([
    '## <script>alert(1)</script>\n**bold** and [[term|a "quoted" <def>]]\n\n> **In practice**\n> <img src=x onerror=alert(2)>',
    'no steps at all', '> plain callout',
  ]);
  for (const md of bodies) {
    const ours = parseLesson(md);
    assert.deepEqual(plain(clientParse(md)), ours);
    for (const s of [...ours.steps, ...(ours.callout ? [ours.callout] : [])]) {
      assert.equal(clientInline(s.p), inline(s.p));
    }
  }
});
