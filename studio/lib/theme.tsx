/**
 * An academy's tokens, written after the stylesheet's defaults. Only the
 * ten contract tokens, each checked against the contract's own patterns
 * by packages/shared, so nothing else can reach the style element.
 */
import { sanitiseBrand, type Tokens } from '../../packages/shared/brand';

export function tokenCss(raw: unknown): string {
  const { tokens } = sanitiseBrand({ tokens: raw });
  const decls = (Object.entries(tokens) as [keyof Tokens, string][]).map(([name, value]) => `${name}:${value}`);
  return decls.length ? `:root{${decls.join(';')}}` : '';
}

export function Theme({ tokens }: { tokens: unknown }) {
  const css = tokenCss(tokens);
  return css ? <style>{css}</style> : null;
}
