/**
 * Contrast, per WCAG 2.x. The academy-design skill's floor is 4.5:1 for
 * text, checked for every academy's palette; the studio refuses a
 * palette that fails it, and says which pair failed and by how much.
 *
 * Each pair is a real use in the product, so a failure names what a
 * learner would struggle to read.
 */
import { resolveTokens, type BrandToken, type Tokens } from './brand.js';

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export const TEXT_MINIMUM = 4.5;

export const CONTRAST_PAIRS: ReadonlyArray<{ text: BrandToken; on: BrandToken; use: string }> = [
  { text: '--ink', on: '--surface', use: 'body text on the page' },
  { text: '--ink', on: '--surface-raised', use: 'body text in cards' },
  { text: '--ink-soft', on: '--surface', use: 'secondary text on the page' },
  { text: '--ink-soft', on: '--surface-raised', use: 'secondary text in cards' },
  { text: '--brand-ink', on: '--brand', use: 'button labels' },
  { text: '--accent-ink', on: '--accent', use: 'labels on earned moments' },
  { text: '--brand', on: '--surface', use: 'links and active text on the page' },
  { text: '--brand', on: '--surface-raised', use: 'links and active text in cards' },
];

export interface ContrastFailure {
  text: BrandToken;
  on: BrandToken;
  use: string;
  ratio: number;
  minimum: number;
}

/** Checks the palette an academy would actually show: its tokens over the defaults. */
export function checkPalette(tokens: Partial<Tokens>): { ok: boolean; failures: ContrastFailure[] } {
  const all = resolveTokens(tokens);
  const failures = CONTRAST_PAIRS.flatMap(({ text, on, use }) => {
    const ratio = Math.round(contrastRatio(all[text], all[on]) * 100) / 100;
    return ratio < TEXT_MINIMUM ? [{ text, on, use, ratio, minimum: TEXT_MINIMUM }] : [];
  });
  return { ok: failures.length === 0, failures };
}
