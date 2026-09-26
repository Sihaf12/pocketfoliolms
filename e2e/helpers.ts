/** Shared by the end-to-end specs: hosts, the demo team, signing in, and the checks every screen gets. */
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Browser, type Page, type TestInfo } from '@playwright/test';
// Built by scripts/demo.sh before the servers start.
import { stepOf, totpAt } from '../dist/src/auth/totp.js';

export const PORT = 3301;
export const GTL = 'gtl.academy.test';
export const MERIDIAN = 'meridian.academy.test';
export const CONSOLE = 'console.academy.test';
export const ACADEMIES = [GTL, MERIDIAN] as const;

interface Team { password: string; owner: { email: string; totpSecret: string } }
export const team = (): Team => JSON.parse(readFileSync('.demo/e2e/team.json', 'utf8')) as Team;

export const at = (host: string, path: string) => `http://${host}:${PORT}${path}`;
export const unique = (label: string) => `e2e ${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

export async function signInStudio(page: Page, host: string, who: 'admin' | 'author' | 'reviewer' | 'compliance') {
  await page.goto(at(host, '/studio/sign-in'));
  await page.getByLabel('Email').fill(`${who}@${host}`);
  await page.getByLabel('Password').fill(team().password);
  await page.getByRole('button', { name: 'Sign in to the studio' }).click();
  await page.waitForURL((u) => !u.pathname.includes('sign-in'));
}

/**
 * The owner's TOTP code works once, so a second sign-in inside the same
 * 30 seconds waits for the next one, as a person would.
 */
export async function signInConsole(page: Page, who: 'owner' | 'author' | 'reviewer' | 'compliance') {
  const { password, owner } = team();
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(at(CONSOLE, '/sign-in'));
    await page.getByLabel('Email').fill(`${who}@${CONSOLE}`);
    await page.getByLabel('Password').fill(password);
    if (who === 'owner') await page.getByLabel('Code from your authenticator').fill(totpAt(owner.totpSecret, stepOf(Date.now() / 1000)));
    await page.getByRole('button', { name: 'Sign in to the console' }).click();
    const outcome = await Promise.race([
      page.waitForURL((u) => !u.pathname.includes('sign-in')).then(() => 'in' as const),
      // Not getByRole('alert'): Next.js's route announcer has that role too.
      page.locator('.notice.danger').waitFor().then(() => 'refused' as const),
    ]);
    if (outcome === 'in') return;
    await page.waitForTimeout(31_000 - (Date.now() % 30_000));
  }
  throw new Error(`could not sign ${who} in to the console`);
}

/** A second person, in their own browser context, for the steps that need a different signer. */
export async function asAnother(browser: Browser, info: TestInfo) {
  const context = await browser.newContext(info.project.use);
  return { page: await context.newPage(), close: () => context.close() };
}

/** Waits for entrances to finish: contrast measured mid-fade would be the fade's, not the page's. */
export async function settle(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) =>
    a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity), undefined, { timeout: 5_000 });
}

/** Axe at WCAG 2.1 AA: contrast in this academy's palette, names, roles, landmarks. */
export async function expectAccessible(page: Page, what: string) {
  await settle(page);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const found = result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')})`);
  expect(found, `${what} has accessibility violations`).toEqual([]);
}

/** A full-page picture for the review, under test-results/screens/<project>/. */
export async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: `test-results/screens/${info.project.name}/${name}.png`, fullPage: true });
}

/**
 * An API call from inside the page, on the page's own host, with its
 * cookies. Not page.request: that resolves hosts outside the browser,
 * where *.academy.test only exists if /etc/hosts says so.
 */
export async function api<T = unknown>(page: Page, path: string, init: { method?: string; data?: unknown } = {}): Promise<{ status: number; body: T }> {
  return page.evaluate(async ({ path, method, data }) => {
    const res = await fetch(path, {
      method, headers: data === undefined ? {} : { 'content-type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }, { path, method: init.method ?? 'GET', data: init.data });
}

/** The keyboard reaches the page and every stop it lands on shows the brand-coloured ring. */
export async function expectKeyboardFocus(page: Page, what: string) {
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  const brand = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim());
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return { tag: el.tagName, style: s.outlineStyle, width: parseFloat(s.outlineWidth), color: s.outlineColor, visible: el.matches(':focus-visible') };
    });
    if (!ring) continue;
    expect(ring.visible, `${what}: focus stop ${i + 1} (${ring.tag}) is focus-visible`).toBe(true);
    expect(ring.style, `${what}: focus stop ${i + 1} (${ring.tag}) has an outline`).not.toBe('none');
    expect(ring.width, `${what}: focus stop ${i + 1} (${ring.tag}) outline width`).toBeGreaterThanOrEqual(2);
    expect(toHex(ring.color), `${what}: focus stop ${i + 1} (${ring.tag}) outline is the brand colour`).toBe(brand.toUpperCase());
  }
}

function toHex(rgb: string): string {
  const m = rgb.match(/\d+/g);
  if (!m) return rgb;
  return `#${m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** Under reduced motion nothing animates and nothing transitions. */
export async function expectStill(page: Page, what: string) {
  const moving = await page.evaluate(() => [...document.querySelectorAll('*')].flatMap((el) => {
    const s = getComputedStyle(el);
    const durations = `${s.transitionDuration},${s.animationDuration}`.split(',').map((d) => parseFloat(d));
    return (s.animationName !== 'none' && parseFloat(s.animationDuration) > 0) || durations.some((d) => d > 0)
      ? [`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(' ')[0]}`] : [];
  }));
  expect(moving, `${what}: moves under reduced motion`).toEqual([]);
  expect(await page.evaluate(() => document.getAnimations().length), `${what}: running animations`).toBe(0);
}

