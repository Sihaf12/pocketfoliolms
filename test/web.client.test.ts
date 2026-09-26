/**
 * Demo wiring · stage 5. The client holds no rule it could disagree with
 * the server about: no answer keys, no baseline formula, no gates, no
 * grading, no invented numbers. If one comes back, this fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

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
  assert.doesNotMatch(page, /data-theme/);
  assert.match(page, /<\/head>/, 'the head the server injects the academy into');
  assert.match(page, /document\.getElementById\('academy'\)/, 'the academy is read from the injected block');
});
