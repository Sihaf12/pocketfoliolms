/**
 * An academy's tokens, written after the stylesheet's defaults. Only the
 * ten contract tokens, each checked against the contract's own patterns
 * by packages/shared, so nothing else can reach the style element.
 */
import { resolveTokens, sanitiseBrand, tokenStylesheet } from '../../packages/shared/brand';
import { luminance } from '../../packages/shared/contrast';

export function Theme({ tokens }: { tokens: unknown }) {
  const css = tokenStylesheet(tokens);
  return css ? <style>{css}</style> : null;
}

/** A dark academy is a token set, not a mode: it is dark when its page surface is. */
export function isDark(raw: unknown): boolean {
  const { tokens } = sanitiseBrand({ tokens: raw });
  return luminance(resolveTokens(tokens)['--surface']) < 0.2;
}
