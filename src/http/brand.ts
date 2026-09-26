/**
 * Academy branding, from app.tenants.brand to the page head.
 *
 * The brand is data an operator typed, and it lands inside a <style> and
 * a <script> element, so it is treated as hostile: only the prototype's
 * own CSS variables are accepted, only as hex colours or small pixel
 * radii, and everything else is dropped. The JSON block is escaped so no
 * value can close the element it sits in.
 */

const COLOUR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RADIUS = /^\d{1,2}px$/;

const COLOUR_TOKENS = [
  '--brand', '--brand-d', '--brand-t', '--accent', '--accent-ink', '--brandtext',
  '--bg', '--surface', '--surface-2', '--line', '--line-2', '--ink', '--muted', '--faint',
  '--ok', '--ok-t', '--warn', '--warn-t', '--bad', '--bad-t',
  '--learn', '--safeguard', '--apply', '--specialise',
] as const;
const RADIUS_TOKENS = ['--r', '--r-s', '--r-l'] as const;

const RULES = new Map<string, RegExp>([
  ...COLOUR_TOKENS.map((t) => [t, COLOUR] as [string, RegExp]),
  ...RADIUS_TOKENS.map((t) => [t, RADIUS] as [string, RegExp]),
]);

export type Mode = 'light' | 'dark';

export interface Brand {
  sub: string;
  mode: Mode;
  tokens: Record<string, string>;
  /** Tokens that were present but refused, for logging and for the seed check. */
  refused: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function sanitiseBrand(raw: unknown): Brand {
  const brand = isRecord(raw) ? raw : {};
  const sub = typeof brand.sub === 'string' && brand.sub.length <= 80 ? brand.sub : '';
  const mode: Mode = brand.mode === 'dark' ? 'dark' : 'light';
  const given = isRecord(brand.tokens) ? brand.tokens : {};
  // Emitted in the allowlist's order, not jsonb's, so the page is stable.
  const tokens: Record<string, string> = {};
  for (const [name, rule] of RULES) {
    const value = given[name];
    if (typeof value === 'string' && rule.test(value)) tokens[name] = value;
  }
  const refused = Object.keys(given).filter((name) => !(name in tokens));
  return { sub, mode, tokens, refused };
}

/** JSON that is safe inside <script type="application/json">. */
export function jsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(new RegExp('\\u2028', 'g'), '\\u2028')
    .replace(new RegExp('\\u2029', 'g'), '\\u2029');
}

/** The page with the academy's tokens and identity added to its head. */
export function brandPage(page: string, name: string, brand: Brand): string {
  const css = Object.entries(brand.tokens).map(([k, v]) => `${k}:${v}`).join(';');
  const head =
    `<style id="academy-tokens">:root{${css}}</style>\n` +
    `<script id="academy" type="application/json">${jsonForHtml({ name, sub: brand.sub, mode: brand.mode })}</script>\n`;
  return page
    .replace(/<html\b/, `<html data-mode="${brand.mode}"`)
    .replace('</head>', `${head}</head>`);
}
