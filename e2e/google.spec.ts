/**
 * Google sign-in for learners, through the local stand-in for Google that
 * scripts/demo.sh starts for this run. The browser crosses all three
 * hosts: the academy, the stand-in, and the callback host (localhost).
 */
import { expect, test, type Page } from '@playwright/test';
import { ACADEMIES, PORT, api, at, expectAccessible, expectKeyboardFocus, expectStill, shot, unique } from './helpers';

const CALLBACK = `localhost:${PORT}`;

/** At the stand-in's page: who signs in, or Cancel. */
async function atGoogle(page: Page) {
  await page.waitForURL((u) => u.host === '127.0.0.1:3302' && u.pathname === '/authorize');
  await expect(page.getByText('Scope asked for: openid email profile')).toBeVisible();
}

for (const host of ACADEMIES) {
  const label = host.split('.')[0]!;

  test(`a new learner continues with Google from sign-up to onboarding in ${label}`, async ({ page }) => {
    const email = `${unique('google').replace(/\s/g, '-')}@example.com`;
    await page.goto(at(host, '/signup?ref=IB-E2E'));
    await expect(page.getByText('By continuing, you agree that this academy keeps your learning record.')).toBeVisible();
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    await atGoogle(page);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Name').fill('Grace Google');
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.waitForURL(at(host, '/onboarding'));
    const me = (await api<{ user: { email: string; displayName: string; lifecycle: string; ibRefCode: string | null } }>(page, '/api/v1/me')).body;
    expect(me.user).toMatchObject({ email, displayName: 'Grace Google', lifecycle: 'registered', ibRefCode: 'IB-E2E' });
  });

  test(`cancelling at Google comes back to sign-in with the reason, accessibly, in ${label}`, async ({ page }, info) => {
    await page.goto(at(host, '/signin'));
    await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    await atGoogle(page);
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.waitForURL(at(host, '/signin?sso=cancelled'));
    await expect(page.locator('.problem')).toHaveText('Google sign-in was cancelled. Try again, or sign in with your email.');
    await expect(page.locator('.problem')).toBeFocused();
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
    await expectAccessible(page, `${label}-signin-google`);
    await expectKeyboardFocus(page, `${label}-signin-google`);
    await shot(page, info, `learner-${label}-signin-google-cancelled`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expectStill(page, `${label}-signin-google`);
  });
}

test('the Google button reaches the stand-in by keyboard', async ({ page }) => {
  await page.goto(at(ACADEMIES[0], '/signin'));
  await page.getByRole('link', { name: 'Continue with Google' }).focus();
  await page.keyboard.press('Enter');
  await atGoogle(page);
});

test('the callback host has no pages, and a state it never issued names no academy', async ({ page }) => {
  for (const path of ['/', '/signin', '/studio']) {
    const res = await page.goto(`http://${CALLBACK}${path}`);
    expect(res?.status(), path).toBe(404);
  }
  const lost = await page.goto(`http://${CALLBACK}/api/auth/google/callback?state=never-issued&code=x`);
  expect(lost?.status()).toBe(400);
  await expect(page.getByText('This sign-in has expired or was already used')).toBeVisible();
});
