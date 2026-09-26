/**
 * Module 4a · packages/shared: the brand contract, contrast, and the
 * lesson Markdown subset. Pure: no database.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_ASSET, videoAssetProblem } from '../packages/shared/content.js';
import { lessonDraftSchema } from '../src/content/model.js';
import { SLUG, hostProblem, slugProblem } from '../packages/shared/names.js';
import { normaliseHost } from '../src/http/tenantScope.js';
import { BRAND_TOKENS, DEFAULT_TOKENS, resolveTokens, sanitiseBrand } from '../packages/shared/brand.js';
import { CONTRAST_PAIRS, checkPalette, contrastRatio } from '../packages/shared/contrast.js';
import { escapeHtml, inline, lessonProblems, parseLesson } from '../packages/shared/markdown.js';
import { demoDocument } from './demoContent.js';

test('the brand contract is the skill\'s ten tokens, and the default academy sets all of them', () => {
  assert.deepEqual(BRAND_TOKENS.map((t) => t.name), [
    '--brand', '--brand-ink', '--accent', '--accent-ink', '--surface', '--surface-raised',
    '--line', '--ink', '--ink-soft', '--radius',
  ]);
  assert.deepEqual(Object.keys(DEFAULT_TOKENS), BRAND_TOKENS.map((t) => t.name));
  assert.equal(resolveTokens({ '--brand': '#000000' })['--brand'], '#000000');
  assert.equal(resolveTokens({})['--ink'], DEFAULT_TOKENS['--ink']);
});

test('the sanitiser keeps contract tokens with valid values, in contract order, and refuses the rest', () => {
  const b = sanitiseBrand({ sub: 'Ok', tokens: {
    '--radius': '12px', '--brand': '#abcdef', '--learn': '#000000', '--ink': '#11223380', '--surface': 'white',
  } });
  assert.deepEqual(Object.keys(b.tokens), ['--brand', '--radius']);
  assert.deepEqual(b.refused.sort(), ['--ink', '--learn', '--surface'],
    'tier colours are not an academy\'s to set; alpha and names are not colours');
});

test('contrast ratios follow WCAG', () => {
  assert.equal(Math.round(contrastRatio('#FFFFFF', '#000000')), 21);
  assert.equal(contrastRatio('#1A6DC2', '#1A6DC2'), 1);
  assert.equal(Math.round(contrastRatio('#FFFFFF', '#1A6DC2') * 10) / 10, 5.2);
  assert.equal(contrastRatio('#fff', '#FFFFFF'), 1, 'short hex is expanded');
});

test('the default palette and every demo academy pass every pair', () => {
  assert.deepEqual(checkPalette({}), { ok: true, failures: [] });
  for (const a of demoDocument().academies) {
    const result = checkPalette(sanitiseBrand(a.brand).tokens);
    assert.deepEqual(result.failures, [], a.slug);
  }
});

test('a failing palette names each pair, what it is used for, and by how much it fails', () => {
  const result = checkPalette({ '--ink-soft': '#AAB4C0', '--brand': '#FACC15' });
  assert.equal(result.ok, false);
  const names = result.failures.map((f) => `${f.text} on ${f.on}`);
  assert.ok(names.includes('--ink-soft on --surface-raised'));
  assert.ok(names.includes('--brand-ink on --brand'), 'white labels on a yellow button');
  assert.ok(names.includes('--brand on --surface-raised'), 'yellow links on white');
  for (const f of result.failures) {
    assert.ok(f.ratio < f.minimum);
    assert.equal(f.minimum, 4.5);
    assert.ok(CONTRAST_PAIRS.some((p) => p.text === f.text && p.on === f.on && p.use === f.use));
  }
});

test('lesson text is escaped, with bold and glossary terms as the only markup', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(inline('Use **leverage** with [[margin|The cash you "post"]] <b>not</b>'),
    'Use <b>leverage</b> with <span class="term" data-def="The cash you &quot;post&quot;">margin</span> &lt;b&gt;not&lt;/b&gt;');
  assert.equal(inline('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});

test('a lesson parses into steps and a callout', () => {
  const doc = parseLesson('## One\nFirst line\nsecond line\n\n## Two\nText\n\nmore for two\n\n> **In practice**\n> Do the thing.');
  assert.deepEqual(doc, {
    steps: [{ h: 'One', p: 'First line second line' }, { h: 'Two', p: 'Text more for two' }],
    callout: { h: 'In practice', p: 'Do the thing.' },
  });
});

test('every demo lesson passes the submission check, and broken lessons are explained', () => {
  for (const l of demoDocument().lessons) assert.deepEqual(lessonProblems(l.body), [], l.code);
  assert.deepEqual(lessonProblems('Just a paragraph.'), ['Add at least one step, starting with "## ".']);
  assert.ok(lessonProblems('## Step\nText with [[broken term]]').includes('Write every glossary term as [[term|definition]].'));
  assert.ok(lessonProblems('## Step\nText\n\n### Too deep\nx').some((p) => p.startsWith('Use "## "')));
  assert.ok(lessonProblems('## Empty\n\n## Next\nok').includes('Step 1 ("Empty") needs some text.'));
});

test('the video reference rule is one rule: the API schema uses the shared pattern the studio checks with', () => {
  assert.equal(lessonDraftSchema.properties.videoAsset.pattern, VIDEO_ASSET.source);
  for (const ok of [null, '', 'lessons/reading-a-spread.mp4', 'a', 'A1/b_c.d-e']) assert.equal(videoAssetProblem(ok), null, String(ok));
  const problems: [string, RegExp][] = [
    ['https://cdn.example.com/v.mp4', /not a web address/],
    ['lessons/a video.mp4', /spaces/],
    ['/lessons/v.mp4', /Start with a letter or a digit/],
    ['lessons/v?.mp4', /only letters, digits/],
    ['a'.repeat(301), /300/],
  ];
  for (const [value, says] of problems) {
    assert.match(videoAssetProblem(value) ?? '', says, value);
    assert.equal(VIDEO_ASSET.test(value), false, `${value}: the API refuses what the studio flags`);
  }
});

test('short names and host names: the form flags exactly what the API refuses', () => {
  for (const slug of ['harbour', 'harbour-trading', 'a', 'x1', 'a'.repeat(40)]) assert.equal(slugProblem(slug), null, slug);
  for (const slug of ['Harbour', 'harbour trading', '-harbour', 'harbour-', 'a'.repeat(41), 'harbour_trading']) {
    assert.ok(slugProblem(slug), slug);
    assert.equal(SLUG.test(slug), false, slug);
  }
  for (const host of ['learn.broker.com', 'a.b', 'x-1.academy.test']) {
    assert.equal(hostProblem(host), null, host);
    assert.equal(normaliseHost(host), host, `${host}: the API takes it as it is`);
  }
  const refused: [string, RegExp][] = [
    ['learn.broker.com:8080', /port/], ['https://learn.broker.com', /https/], ['learn.broker.com/academy', /path/],
    ['Learn.Broker.com', /lowercase/], ['localhost', /dot/], ['learn.broker.com.', /dot at the end/], ['-x.broker.com', /hyphen/],
  ];
  for (const [host, says] of refused) {
    assert.match(hostProblem(host) ?? '', says, host);
    assert.notEqual(normaliseHost(host), host, `${host}: the API does not take it as given either`);
  }
});
