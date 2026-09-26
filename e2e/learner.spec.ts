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
