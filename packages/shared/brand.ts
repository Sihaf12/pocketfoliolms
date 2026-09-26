/**
 * The academy brand contract, from the academy-design skill.
 *
 * An academy may set these ten tokens and nothing else. Type, spacing,
 * motion, the status colours and the four tier colours are the same in
 * every academy, so the product still reads as one product while the
 * brand reads as that broker's. A dark academy is a token set, not a mode.
 *
 * Used by the API when it serves or stores a brand, and by the studio
 * when it previews one, so the two cannot disagree.
 */

/** #RGB or #RRGGBB. No alpha: contrast cannot be judged through transparency. */
export const COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const RADIUS = /^\d{1,2}px$/;

export const BRAND_TOKENS = [
  { name: '--brand', kind: 'colour', purpose: 'Primary action, active states, the lit path node' },
  { name: '--brand-ink', kind: 'colour', purpose: 'Text on brand' },
  { name: '--accent', kind: 'colour', purpose: 'One warm highlight, for earned moments only' },
  { name: '--accent-ink', kind: 'colour', purpose: 'Text on accent' },
  { name: '--surface', kind: 'colour', purpose: 'Page background' },
  { name: '--surface-raised', kind: 'colour', purpose: 'Cards and panels' },
  { name: '--line', kind: 'colour', purpose: 'Hairline borders' },
  { name: '--ink', kind: 'colour', purpose: 'Body text' },
  { name: '--ink-soft', kind: 'colour', purpose: 'Secondary text' },
  { name: '--radius', kind: 'radius', purpose: 'One value; components derive theirs from it' },
] as const;

export type BrandToken = (typeof BRAND_TOKENS)[number]['name'];
export type Tokens = Record<BrandToken, string>;

/** The default academy, Global Tutoring Lab. */
export const DEFAULT_TOKENS: Tokens = {
  '--brand': '#1A6DC2',
  '--brand-ink': '#FFFFFF',
  '--accent': '#F5C400',
  '--accent-ink': '#1F1A00',
  '--surface': '#F4F7FB',
  '--surface-raised': '#FFFFFF',
  '--line': '#DCE4EE',
  '--ink': '#14203A',
  '--ink-soft': '#5D6D85',
  '--radius': '16px',
};

export interface Brand {
  sub: string;
  /** Only the tokens the academy set, in contract order. The rest inherit the default. */
  tokens: Partial<Tokens>;
  /** Names that were present but refused: unknown, or not a valid value. */
  refused: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function sanitiseBrand(raw: unknown): Brand {
  const brand = isRecord(raw) ? raw : {};
  const sub = typeof brand.sub === 'string' && brand.sub.length <= 80 ? brand.sub : '';
  const given = isRecord(brand.tokens) ? brand.tokens : {};
  const tokens: Partial<Tokens> = {};
  for (const { name, kind } of BRAND_TOKENS) {
    const value = given[name];
    if (typeof value === 'string' && (kind === 'colour' ? COLOUR : RADIUS).test(value)) tokens[name] = value;
  }
  const refused = Object.keys(given).filter((name) => !(name in tokens));
  return { sub, tokens, refused };
}

/** Every token, with the academy's values over the defaults. */
export function resolveTokens(tokens: Partial<Tokens>): Tokens {
  return { ...DEFAULT_TOKENS, ...tokens };
}
