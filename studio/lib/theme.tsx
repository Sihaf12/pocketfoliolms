/**
 * An academy's tokens, written after the stylesheet's defaults. Only the
 * ten contract tokens, each checked against the contract's own patterns
 * by packages/shared, so nothing else can reach the style element.
 */
import { resolveTokens, sanitiseBrand, type Tokens } from '../../packages/shared/brand';
import { luminance } from '../../packages/shared/contrast';

export function tokenCss(raw: unknown): string {
  const { tokens } = sanitiseBrand({ tokens: raw });
  const decls = (Object.entries(tokens) as [keyof Tokens, string][]).map(([name, value]) => `${name}:${value}`);
  return decls.length ? `:root{${decls.join(';')}}` : '';
}

export function Theme({ tokens }: { tokens: unknown }) {
  const css = tokenCss(tokens);
  return css ? <style>{css}</style> : null;
}

/** A dark academy is a token set, not a mode: it is dark when its page surface is. */
export function isDark(raw: unknown): boolean {
  const { tokens } = sanitiseBrand({ tokens: raw });
  return luminance(resolveTokens(tokens)['--surface']) < 0.2;
}
