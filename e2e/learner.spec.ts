/**
 * Module 4b: the learner app, in GTL and in Meridian's dark tokens, at
 * phone and desktop width. Every screen gets axe at WCAG 2.1 AA, the
 * brand-coloured focus ring for the keyboard, and stillness under
 * reduced motion.
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { ACADEMIES, answerKeys, api, at, expectAccessible, expectKeyboardFocus, expectStill, shot, team, unique } from './helpers';

async function check(page: Page, info: TestInfo, name: string, heading: string | RegExp) {
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  await expectAccessible(page, name);
  await expectKeyboardFocus(page, name);
  await shot(page, info, `learner-${name}`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expectStill(page, name);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}

const newEmail = () => `${unique('learner').replace(/\s/g, '-')}@example.com`;

/** A new learner, signed up through the form. */
export async function signUp(page: Page, host: string, name = 'Amara Osei') {
  const email = newEmail();
  await page.goto(at(host, '/signup'));
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(team().password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/onboarding$/);
  return email;
}

for (const host of ACADEMIES) {
  const label = host.split('.')[0]!;

  test(`landing, sign-up and sign-in in ${label}`, async ({ page }, info) => {
    await page.goto(at(host, '/'));
    await check(page, info, `${label}-landing`, /Learn to trade/);
    const catalogue = (await api<{ courses: { title: string }[] }>(page, '/api/v1/catalogue')).body.courses;
    for (const c of catalogue) await expect(page.getByRole('heading', { level: 3, name: c.title })).toBeVisible();
    await expect(page.getByRole('img', { name: /An example path/ })).toBeVisible();

    await page.goto(at(host, '/signup'));
    await check(page, info, `${label}-signup`, 'Create your account');
    await page.getByRole('link', { name: 'Sign in' }).click();
    await check(page, info, `${label}-signin`, 'Welcome back');
  });

  test(`a new learner signs up and answers the onboarding questions by keyboard in ${label}`, async ({ page }, info) => {
    await signUp(page, host);
    await check(page, info, `${label}-onboarding-1`, 'What are you here for?');
    const next = page.getByRole('button', { name: 'Next' });
    await expect(next).toBeDisabled();

    // Arrow keys move the choice within a group, as radio groups do.
    const goals = page.getByRole('radiogroup', { name: 'What do you want from this?' });
    await goals.getByRole('radio').first().focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
    await expect(goals.getByRole('radio', { name: 'I have traded a little' })).toHaveAttribute('aria-checked', 'true');
    await expect(goals.getByRole('radio', { name: 'I have traded a little' })).toBeFocused();
    await page.getByRole('radiogroup', { name: 'How much time on a typical day?' }).getByRole('radio', { name: '20 minutes' }).click();
    await next.click();

    await check(page, info, `${label}-onboarding-2`, 'How confident do you feel?');
    // Confidence is a 1 to 5 row, not a slider.
    await expect(page.getByRole('slider')).toHaveCount(0);
    const learn = page.getByRole('radiogroup', { name: /Learn/ });
    await expect(learn.getByRole('radio')).toHaveText(['1', '2', '3', '4', '5']);
    await learn.getByRole('radio', { name: '4' }).click();
    await page.getByRole('button', { name: 'Start the placement check' }).click();
    await page.waitForURL(/\/placement$/);

    const me = (await api<{ user: { lifecycle: string; goal: string; dailyMinutes: number } }>(page, '/api/v1/me')).body;
    expect([me.user.lifecycle, me.user.goal, me.user.dailyMinutes]).toEqual(['onboarded', 'some_experience', 20]);
  });
}

test('sign-up shows each refusal beside its field; sign-in takes a learner back where they belong', async ({ page }) => {
  const host = ACADEMIES[0];
  await page.goto(at(host, '/signup'));
  await page.getByLabel('Name').fill('Short Password');
  await page.getByLabel('Email').fill(newEmail());
  await page.getByLabel('Password').fill('too short');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  const password = page.getByLabel('Password');
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.field').filter({ has: password }).locator('.err')).toHaveText('Use at least 12 characters.');
  await expect(password).toBeFocused();

  const email = await signUp(page, host, 'Returning Learner');
  await api(page, '/api/v1/auth/logout', { method: 'POST' });
  await page.goto(at(host, '/signin'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('not the password at all');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.problem')).toBeVisible();
  await page.getByLabel('Password').fill(team().password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/onboarding$/, { timeout: 10_000 });
});

/** A learner signed up and onboarded through the API, on this page, ready for placement. */
async function onboarded(page: Page, host: string) {
  await page.goto(at(host, '/signin'));
  const email = newEmail();
  expect((await api(page, '/api/v1/auth/signup', { method: 'POST', data: { email, password: team().password, displayName: 'Placement Learner' } })).status).toBe(201);
  expect((await api(page, '/api/v1/onboarding', {
    method: 'PUT', data: { selfRating: { learn: 50, safeguard: 25, apply: 25, specialise: 0 }, goal: 'new', dailyMinutes: 20 },
  })).status).toBe(200);
  return email;
}

for (const host of ACADEMIES) {
  const label = host.split('.')[0]!;

  test(`placement, starting point, path and explore in ${label}`, async ({ page }, info) => {
    await onboarded(page, host);
    await page.goto(at(host, '/placement'));
    await expect(page.getByText('1 of 8', { exact: true })).toBeVisible();
    const first = (await page.getByRole('heading', { level: 1 }).textContent())!;
    await check(page, info, `${label}-placement`, first);

    // Skip sits in the top row, beside the tier and the count, above the question.
    const skip = page.getByRole('button', { name: 'Not covered yet' });
    const count = page.getByText('1 of 8', { exact: true });
    expect(Math.abs((await skip.boundingBox())!.y - (await count.boundingBox())!.y)).toBeLessThan(24);
    expect((await skip.boundingBox())!.y).toBeLessThan((await page.getByRole('heading', { level: 1 }).boundingBox())!.y);

    // An answer holds for 400ms, then the next question comes by itself.
    await page.keyboard.press('a');
    await expect(page.locator('.opt[aria-pressed="true"]')).toHaveCount(1);
    await page.waitForTimeout(250);
    await expect(page.getByText('1 of 8', { exact: true })).toBeVisible();
    await expect(page.getByText('2 of 8', { exact: true })).toBeVisible({ timeout: 1_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();

    await skip.click();
    await expect(page.getByText('3 of 8', { exact: true })).toBeVisible();
    for (let n = 3; n <= 8; n++) {
      await expect(page.getByText(`${n} of 8`, { exact: true })).toBeVisible();
      await page.keyboard.press('a');
      if (n < 8) await expect(page.getByText(`${n + 1} of 8`, { exact: true })).toBeVisible({ timeout: 1_500 });
    }
    await page.waitForURL(/\/start$/);

    // The bars fill one after another, each number rolling up to its score.
    const bars = page.locator('.tierbar .bar i');
    await expect(bars).toHaveCount(4);
    await page.waitForTimeout(600);
    const early = await bars.evaluateAll((els) => els.map((e) => (e as HTMLElement).style.width));
    expect(early[0]).not.toBe('0px');
    expect(early[3]).toMatch(/^0(px)?$/);
    const pathway = (await api<{ level: string; baseline: Record<string, number> }>(page, '/api/v1/pathway')).body;
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(pathway.level[0]!.toUpperCase() + pathway.level.slice(1));
    await expect(page.locator('.tierbar .row b')).toHaveText(['learn', 'safeguard', 'apply', 'specialise'].map((t) => String(pathway.baseline[t])), { timeout: 4_000 });
    await check(page, info, `${label}-start`, /./);

    await page.getByRole('link', { name: 'See my path' }).click();
    await page.waitForURL(/\/path$/);
    await check(page, info, `${label}-path`, 'Your path');
    await expect(page.getByRole('link', { name: /^Continue/ })).toBeVisible();

    // A locked lesson says what opens it: a sheet on a phone, a popover on a desktop.
    const locked = page.locator('.node.locked').first();
    await locked.focus();
    await page.keyboard.press('Enter');
    const phone = (page.viewportSize()?.width ?? 0) < 768;
    const detail = page.locator(phone ? '.sheet' : '.pop');
    await expect(detail).toBeVisible();
    await expect(detail.locator('.lock')).toHaveText(/^(Requires|Unlocks at)/);
    if (phone) await expect(page.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    await expectAccessible(page, `${label} lesson detail`);
    await shot(page, info, `learner-${label}-path-detail`);
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await expect(locked).toBeFocused();

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Explore' }).first().click();
    await check(page, info, `${label}-explore`, 'Explore');
  });
}

interface PathLesson { id: string; title: string; state: string }
interface Path { tiers: { tier: string; courses: { title: string; lessons: PathLesson[] }[] }[] }
interface Paper { attemptId: string; questions: { id: string; options: { key: string }[] }[] }

/** A placed learner who got everything right in placement, so every tier is open. */
async function placed(page: Page, host: string) {
  await onboarded(page, host);
  const paper = (await api<Paper>(page, '/api/v1/placement', { method: 'POST' })).body;
  const keys = await answerKeys(paper.questions.map((q) => q.id));
  expect((await api(page, `/api/v1/placement/${paper.attemptId}/submission`, { method: 'POST', data: { answers: keys } })).status).toBe(200);
}

async function lessonsByTitle(page: Page): Promise<Map<string, PathLesson>> {
  const path = (await api<Path>(page, '/api/v1/pathway')).body;
  return new Map(path.tiers.flatMap((t) => t.courses.flatMap((c) => c.lessons)).map((l) => [l.title, l]));
}

/** Passes a lesson's check through the API, one answer at a time as the app does. */
async function pass(page: Page, lessonId: string) {
  const paper = (await api<Paper>(page, `/api/v1/lessons/${lessonId}/checks`, { method: 'POST' })).body;
  const keys = await answerKeys(paper.questions.map((q) => q.id));
  for (const q of paper.questions) await api(page, `/api/v1/checks/${paper.attemptId}/answers`, { method: 'POST', data: { questionId: q.id, key: keys[q.id] } });
  expect((await api(page, `/api/v1/checks/${paper.attemptId}/submission`, { method: 'POST', data: { answers: keys } })).status).toBe(200);
}

for (const host of ACADEMIES) {
  const label = host.split('.')[0]!;

  test(`a lesson, its check and the verified moment in ${label}`, async ({ page }, info) => {
    await placed(page, host);
    const lessons = await lessonsByTitle(page);
    const first = [...lessons.values()].find((l) => l.state === 'open')!;
    await page.goto(at(host, `/learn/${first.id}`));
    await check(page, info, `${label}-lesson`, first.title);
    await expect(page.locator('.rd h2').first()).toBeVisible();

    await page.getByRole('link', { name: 'Check my understanding' }).click();
    await page.waitForURL(/\/check$/);
    await expect(page.getByText('1 of 3', { exact: true })).toBeVisible();
    await check(page, info, `${label}-check`, /./);

    // Two right and one wrong: verified, with each rationale unfolding. Asking
    // for the paper again hands back the open one, which says which questions it holds.
    const open = (await api<{ questions: { id: string; prompt: string }[] }>(page, `/api/v1/lessons/${first.id}/checks`, { method: 'POST' })).body;
    const keys = await answerKeys(open.questions.map((q) => q.id));
    for (let n = 0; n < 3; n++) {
      await expect(page.getByText(`${n + 1} of 3`, { exact: true })).toBeVisible();
      const buttons = page.getByRole('group', { name: 'Answers' }).getByRole('button');
      const question = (await page.getByRole('heading', { level: 1 }).textContent())!;
      const correct = keys[open.questions.find((x) => x.prompt === question)!.id]!;
      const want = n === 1 ? (correct === 'a' ? 'b' : 'a') : correct;
      await page.keyboard.press(want);
      const rat = page.locator('.ratwrap');
      await expect(rat).toHaveClass(/open/);
      await expect(page.locator('.rat')).toContainText(n === 1 ? 'Not quite' : 'Correct');
      // It unfolds from nothing, so its height is measured once the unfold is under way.
      await expect.poll(() => rat.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(20);
      if (n === 0) await shot(page, info, `learner-${label}-check-answered`);
      await expect(buttons.first()).toBeDisabled();
      await page.getByRole('button', { name: n < 2 ? 'Next question' : 'See my result' }).click();
    }
    const won = page.getByRole('dialog', { name: 'Verified' });
    await expect(won).toBeVisible();
    await expect(won).toContainText('2 of 3 correct.');
    await expect(won.locator('.xp')).toHaveAccessibleName(/XP$/);
    await expectAccessible(page, `${label} verified moment`);
    await shot(page, info, `learner-${label}-verified`);
    await won.getByRole('link', { name: 'See my path' }).click();
    await page.waitForURL(/\/path$/);

    await page.goto(at(host, '/progress'));
    await check(page, info, `${label}-progress`, 'Your progress');
    await expect(page.getByRole('list', { name: 'Days learned this week' }).locator('li.on')).toHaveCount(1);
    await expect(page.locator('.recentlist')).toContainText(first.title);

    await page.goto(at(host, '/me'));
    await check(page, info, `${label}-me`, 'Placement Learner');
  });

  test(`the simulator turns the page red when a move erases the margin in ${label}`, async ({ page }, info) => {
    await placed(page, host);
    let lessons = await lessonsByTitle(page);
    // Open the way to the simulator lesson by passing what it requires.
    for (let guard = 0; guard < 8 && lessons.get('Leverage and margin')?.state !== 'open'; guard++) {
      const next = [...lessons.values()].find((l) => l.state === 'open')!;
      await pass(page, next.id);
      lessons = await lessonsByTitle(page);
    }
    const sim = lessons.get('Leverage and margin')!;
    await page.goto(at(host, `/learn/${sim.id}`));
    await page.getByRole('tab', { name: 'Try it' }).click();
    await check(page, info, `${label}-simulator`, 'Leverage and margin');
    const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.getByLabel('Leverage').fill('20');
    await page.getByLabel('Adverse move').fill('10');
    await expect(page.locator('.sim')).toHaveAttribute('data-state', 'dead');
    await expect(page.locator('html')).toHaveAttribute('data-zone', 'dead');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(before);
    await expect(page.locator('.verdict')).toContainText('erases your margin entirely');
    await expectAccessible(page, `${label} simulator in the red zone`);
    await shot(page, info, `learner-${label}-simulator-red`);
    await page.getByRole('tab', { name: 'Read' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-zone', /./);
  });

  test(`a finished course's certificate, and its public page with no app around it, in ${label}`, async ({ page, browser }, info) => {
    await placed(page, host);
    const path = (await api<Path>(page, '/api/v1/pathway')).body;
    const course = path.tiers[0]!.courses[0]!;
    for (const l of course.lessons) await pass(page, l.id);
    await page.goto(at(host, '/progress'));
    await page.getByRole('button', { name: `View certificate for ${course.title}` }).click();
    const modal = page.getByRole('dialog', { name: 'Your certificate' });
    await expect(modal).toBeVisible();
    await expectAccessible(page, `${label} certificate`);
    await shot(page, info, `learner-${label}-certificate`);
    const url = await modal.getByLabel('Verification address').inputValue();
    expect(url).toMatch(/\/verify\/PA-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    const visitor = await browser.newContext(info.project.use);
    const v = await visitor.newPage();
    await v.goto(url);
    await check(v, info, `${label}-verify`, 'Valid certificate');
    await expect(v.getByText(course.title)).toBeVisible();
    await expect(v.locator('.topbar, .tabbar, .nav, footer')).toHaveCount(0);
    await v.getByLabel('Check another code').fill('PA-0000-0000');
    await v.getByRole('button', { name: 'Check' }).click();
    await expect(v.getByRole('heading', { level: 1 })).toHaveText('No valid certificate has this code');
    await visitor.close();
  });
}

for (const host of ACADEMIES) {
  const label = host.split('.')[0]!;

  test(`the verify form, a missed check and a locked lesson in ${label}`, async ({ page }, info) => {
    await page.goto(at(host, '/verify'));
    await check(page, info, `${label}-verify-form`, 'Check a certificate');
    await page.getByLabel('Certificate code').fill('not a code');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByRole('status')).toHaveText('NOT A CODE is not a certificate code. Codes look like PA-7K3M-9QXD.');

    await placed(page, host);
    const lessons = await lessonsByTitle(page);
    const locked = [...lessons.values()].find((l) => l.state === 'locked')!;
    await page.goto(at(host, `/learn/${locked.id}`));
    await check(page, info, `${label}-lesson-locked`, 'This lesson is locked');
    await expect(page.locator('.locked-note')).toHaveText(/^(Requires|Unlocks at)/);

    // Every answer wrong: not this time, and another go draws a new paper.
    const first = [...lessons.values()].find((l) => l.state === 'open')!;
    await page.goto(at(host, `/learn/${first.id}/check`));
    await expect(page.getByText('1 of 3', { exact: true })).toBeVisible();
    const open = (await api<{ attemptId: string; questions: { id: string; prompt: string }[] }>(page, `/api/v1/lessons/${first.id}/checks`, { method: 'POST' })).body;
    const keys = await answerKeys(open.questions.map((q) => q.id));
    for (let n = 0; n < 3; n++) {
      await expect(page.getByText(`${n + 1} of 3`, { exact: true })).toBeVisible();
      const prompt = (await page.getByRole('heading', { level: 1 }).textContent())!;
      const right = keys[open.questions.find((q) => q.prompt === prompt)!.id]!;
      await page.keyboard.press(right === 'a' ? 'b' : 'a');
      await page.getByRole('button', { name: n < 2 ? 'Next question' : 'See my result' }).click();
    }
    const miss = page.getByRole('dialog', { name: 'Not this time' });
    await expect(miss).toContainText('0 of 3 correct. Two of three are needed.');
    await expectAccessible(page, `${label} missed check`);
    await shot(page, info, `learner-${label}-missed`);
    await miss.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('1 of 3', { exact: true })).toBeVisible();
    const again = (await api<{ attemptId: string }>(page, `/api/v1/lessons/${first.id}/checks`, { method: 'POST' })).body;
    expect(again.attemptId).not.toBe(open.attemptId);
  });
}

test('from sign-up to the starting point with the keyboard alone', async ({ page }) => {
  const host = ACADEMIES[1];
  await page.goto(at(host, '/signup'));
  const type = async (label: string, value: string) => { await page.getByLabel(label).focus(); await page.keyboard.type(value); };
  await type('Name', 'Keyboard Learner');
  await type('Email', newEmail());
  await type('Password', team().password);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Create account' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/onboarding$/);

  await page.getByRole('radiogroup', { name: 'What do you want from this?' }).getByRole('radio').first().focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Next' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Start the placement check' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/placement$/);

  for (let n = 1; n <= 8; n++) {
    await expect(page.getByText(`${n} of 8`, { exact: true })).toBeVisible();
    await page.keyboard.press('b');
  }
  await page.waitForURL(/\/start$/);
  await expect(page.getByRole('link', { name: 'See my path' })).toBeVisible();
});
