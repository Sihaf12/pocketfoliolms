/**
 * Module 4b: the learner app, in GTL and in Meridian's dark tokens, at
 * phone and desktop width. Every screen gets axe at WCAG 2.1 AA, the
 * brand-coloured focus ring for the keyboard, and stillness under
 * reduced motion.
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { ACADEMIES, api, at, expectAccessible, expectKeyboardFocus, expectStill, shot, team, unique } from './helpers';

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
