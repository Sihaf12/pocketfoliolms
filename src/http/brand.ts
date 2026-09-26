/**
 * Academy branding, from app.tenants.brand to the page head.
 *
 * The contract and its validation live in packages/shared/brand.ts, the
 * same code the studio previews with. What stays here is the one thing
 * only the server does: writing the academy into the page it serves.
 *
 * The brand is data an operator typed, and it lands inside a <style> and
 * a <script> element, so only contract tokens with valid values are
 * written, and the JSON block is escaped so no value can close the
 * element it sits in.
 */
import { BRAND_TOKENS, sanitiseBrand, type Brand } from '../../packages/shared/brand.js';

export { sanitiseBrand, type Brand };

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
  const css = BRAND_TOKENS
    .filter(({ name: token }) => brand.tokens[token] !== undefined)
    .map(({ name: token }) => `${token}:${brand.tokens[token]}`)
    .join(';');
  const head =
    `<style id="academy-tokens">:root{${css}}</style>\n` +
    `<script id="academy" type="application/json">${jsonForHtml({ name, sub: brand.sub })}</script>\n`;
  return page.replace('</head>', `${head}</head>`);
}
