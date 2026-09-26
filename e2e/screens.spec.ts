/**
 * Every screen, in the default academy (GTL) and in Meridian's dark
 * tokens, at phone and desktop width: axe at WCAG 2.1 AA (contrast in
 * that academy's palette included), a visible brand-coloured focus ring
 * for the keyboard, and nothing moving under reduced motion.
 */
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { ACADEMIES, CONSOLE, GTL, api, at, expectAccessible, expectKeyboardFocus, expectStill, shot, signInConsole, signInStudio, team, unique } from './helpers';

const QUESTION = (n: number) => ({
  prompt: `Question ${n}?`,
  options: [{ key: 'a', text: 'Yes' }, { key: 'b', text: 'No' }, { key: 'c', text: 'Sometimes' }],
  correctKey: 'a',
  rationales: { a: 'Right, because it is.', b: 'Not quite: it is.', c: 'Only if it is.' },
});

/** A course with one lesson sent for review, made through the API as the academy's author (signed in on this page). */
async function content(page: Page) {
  const course = (await api<{ version: { entityId: string } }>(page, '/api/studio/courses', {
    method: 'POST', data: { title: unique('Screens course'), summary: 'For the screen checks.', tier: 'learn', estMinutes: 20 },
  })).body;
  const lesson = (await api<{ version: { id: string; entityId: string } }>(page, `/api/studio/courses/${course.version.entityId}/lessons`, {
    method: 'POST',
    data: {
      position: 1, title: unique('Screens lesson'), minutes: 8, xp: 90,
      bodyMd: '## First step\nA **plain** start, with a [[pip|the smallest price move]].\n\n> **In practice**\n> Try it once.',
      questions: [1, 2, 3, 4, 5].map(QUESTION),
    },
  })).body;
  expect((await api(page, `/api/studio/versions/${lesson.version.id}/submit`, { method: 'POST' })).status).toBe(200);
  return { courseId: course.version.entityId, lessonId: lesson.version.entityId, versionId: lesson.version.id };
}

/** A placed learner, signed up on the learner page's API in a context of its own. */
async function learner(browser: Browser, info: TestInfo, host: string): Promise<string> {
  const context = await browser.newContext(info.project.use);
  const page = await context.newPage();
  await page.goto(at(host, '/'));
  const email = `${unique('learner').replace(/\s/g, '-')}@example.com`;
  const signup = await api<{ user: { id: string } }>(page, '/api/v1/auth/signup', {
    method: 'POST', data: { email, password: team().password, displayName: 'Screen Learner' },
  });
  expect(signup.status).toBe(201);
  await api(page, '/api/v1/onboarding', { method: 'PUT', data: { selfRating: { learn: 50, safeguard: 20, apply: 10, specialise: 0 } } });
  const paper = (await api<{ attemptId: string; questions: { id: string }[] }>(page, '/api/v1/placement', { method: 'POST' })).body;
  const answers = Object.fromEntries(paper.questions.map((q) => [q.id, 'a']));
  await api(page, `/api/v1/placement/${paper.attemptId}/submission`, { method: 'POST', data: { answers } });
  await context.close();
  return signup.body.user.id;
}

async function check(page: Page, info: TestInfo, url: string, name: string, ready: string | RegExp) {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: ready })).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
  await expectAccessible(page, name);
  await expectKeyboardFocus(page, name);
  await shot(page, info, name);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expectStill(page, name);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}

for (const host of ACADEMIES) {
  const label = host.split('.')[0]!;

  test(`every studio screen in ${label}`, async ({ page, browser }, info) => {
    test.setTimeout(240_000);
    await check(page, info, at(host, '/studio/sign-in'), `${label}-sign-in`, /Sign in to the .* studio/);
    await check(page, info, at(host, '/studio/invite/not-a-real-invitation-token'), `${label}-invite`, /Join the .* studio/);

    await signInStudio(page, host, 'author');
    const made = await content(page);
    await check(page, info, at(host, '/studio'), `${label}-content`, 'Content');
    await check(page, info, at(host, '/studio/courses/new'), `${label}-course-new`, 'Start a new course');
    await check(page, info, at(host, `/studio/courses/${made.courseId}`), `${label}-course`, /Screens course/);
    await check(page, info, at(host, `/studio/courses/${made.courseId}/lessons/new`), `${label}-lesson-new`, 'New lesson');
    await check(page, info, at(host, `/studio/lessons/${made.lessonId}`), `${label}-lesson-in-review`, /Screens lesson/);
    await check(page, info, at(host, '/studio/more'), `${label}-more-author`, 'More');

    await signInStudio(page, host, 'reviewer');
    await check(page, info, at(host, '/studio/review'), `${label}-review`, 'Review');
    await check(page, info, at(host, `/studio/versions/${made.versionId}`), `${label}-version`, /Screens lesson/);

    const learnerId = await learner(browser, info, host);
    await signInStudio(page, host, 'admin');
    for (const [path, name, heading] of [
      ['/studio/catalogue', 'catalogue', 'Catalogue'],
      ['/studio/learners', 'learners', 'Learners'],
      [`/studio/learners/${learnerId}`, 'learner', 'Screen Learner'],
      ['/studio/team', 'team', 'Team'],
      ['/studio/settings', 'settings', 'Settings'],
      ['/studio/settings/brand', 'brand', 'Brand'],
      ['/studio/settings/review', 'review-rule', 'Review rule'],
      ['/studio/settings/domain', 'domain', 'Domain'],
      ['/studio/settings/crm', 'crm', 'CRM endpoint'],
      ['/studio/settings/deliveries', 'deliveries', 'Deliveries'],
      ['/studio/more', 'more-admin', 'More'],
    ] as const) {
      await check(page, info, at(host, path), `${label}-${name}`, heading);
    }
  });

  test(`the lesson editor and its preview in ${label}`, async ({ page }, info) => {
    await signInStudio(page, host, 'author');
    const course = (await api<{ version: { entityId: string } }>(page, '/api/studio/courses', {
      method: 'POST', data: { title: unique('Editor course'), summary: 'For the editor checks.', tier: 'apply', estMinutes: 20 },
    })).body;
    const lesson = (await api<{ version: { entityId: string } }>(page, `/api/studio/courses/${course.version.entityId}/lessons`, {
      method: 'POST', data: { position: 1, title: unique('Editor lesson'), minutes: 6, xp: 60, bodyMd: '## A step\nWith **bold** text.', questions: [QUESTION(1)] },
    })).body;
    await check(page, info, at(host, `/studio/lessons/${lesson.version.entityId}`), `${label}-lesson-editor`, /Editor lesson/);
    const phone = (page.viewportSize()?.width ?? 0) < 1100;
    if (phone) {
      // One tap apart on a phone, and the toggle works from the keyboard.
      const toggle = page.getByRole('button', { name: 'Preview', exact: true });
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByLabel('Lesson text')).toBeHidden();
    }
    await expect(page.getByRole('figure', { name: 'Learner preview' }).getByRole('heading', { name: 'A step' })).toBeVisible();
    await expectAccessible(page, `${label} lesson preview`);
    await shot(page, info, `${label}-lesson-preview`);

    // Dialogs open without motion when motion is reduced.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(at(host, `/studio/lessons/${lesson.version.entityId}`));
    await expect(page.getByLabel('Lesson text').or(page.getByRole('figure', { name: 'Learner preview' })).first()).toBeVisible();
    await expectStill(page, `${label} lesson editor`);
  });
}

test('every console screen', async ({ page }, info) => {
  test.setTimeout(240_000);
  await check(page, info, at(CONSOLE, '/sign-in'), 'console-sign-in', 'Sign in to the console');
  await check(page, info, at(CONSOLE, '/invite/not-a-real-invitation-token'), 'console-invite', 'Join the platform console');
  await signInConsole(page, 'owner');
  const tenants = (await api<{ tenants: { id: string; name: string; primaryDomain: string }[] }>(page, '/api/console/tenants')).body;
  const gtl = tenants.tenants.find((t) => t.primaryDomain === GTL)!;
  for (const [path, name, heading] of [
    ['/content', 'content', 'Platform content'],
    ['/review', 'review', 'Review'],
    ['/glossary', 'glossary', 'Glossary'],
    ['/academies', 'academies', 'Academies'],
    ['/academies/new', 'academy-new', 'Add an academy'],
    [`/academies/${gtl.id}`, 'academy', gtl.name],
    ['/staff', 'staff', 'Staff'],
    ['/deliveries', 'deliveries', 'Deliveries'],
    ['/more', 'more', 'More'],
  ] as const) {
    await check(page, info, at(CONSOLE, path), `console-${name}`, heading);
  }

  await signInConsole(page, 'author');
  await check(page, info, at(CONSOLE, '/courses/new'), 'console-course-new', 'Start a new course');
  await check(page, info, at(CONSOLE, '/glossary/new'), 'console-term-new', 'Add a term');
});

test('the console and the studios cannot be reached through each other', async ({ page }) => {
  expect((await page.goto(at(GTL, '/academies')))?.status()).toBe(404);
  expect((await page.goto(at(GTL, '/sign-in')))?.status()).toBe(404);
  expect((await page.goto(at(CONSOLE, '/studio')))?.status()).toBe(404);
  expect((await page.goto(at(CONSOLE, '/studio/sign-in')))?.status()).toBe(404);
  await page.goto(at(CONSOLE, '/'));
  await expect(page).toHaveURL(at(CONSOLE, '/sign-in?next=%2Fcontent'));
  await page.goto(at(GTL, '/'));
  expect((await api(page, '/api/console/me')).status).toBe(404);
});
