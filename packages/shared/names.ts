/**
 * The shapes of an academy's short name and of a host name, shared by the
 * API (which refuses anything else) and the console and studio forms
 * (which say what is wrong while it is typed).
 */

/** Lowercase letters, digits and hyphens; 1 to 40 characters; no hyphen at either end. */
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const SLUG_FORMAT = 'Lowercase letters, digits and hyphens, up to 40 characters, not starting or ending with a hyphen. For example: harbour-trading';

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
/** A lowercase DNS name of two or more labels, with no port, path or trailing dot. */
export const HOSTNAME = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})+$`);

export const HOSTNAME_FORMAT = 'A host name with no port, path or https://, such as learn.broker.com';

export function slugProblem(value: string): string | null {
  if (value === '') return null;
  if (/[A-Z]/.test(value)) return 'Use lowercase letters.';
  if (/\s/.test(value)) return 'Use hyphens instead of spaces.';
  if (value.length > 40) return 'Use at most 40 characters.';
  if (value.startsWith('-') || value.endsWith('-')) return 'Start and end with a letter or a digit.';
  if (!SLUG.test(value)) return 'Use only lowercase letters, digits and hyphens.';
  return null;
}

export function hostProblem(value: string): string | null {
  if (value === '') return null;
  if (/^[a-z]+:\/\//i.test(value)) return 'Leave out the https:// at the start.';
  if (/:\d*$/.test(value)) return 'Leave out the port.';
  if (value.includes('/')) return 'Leave out any path: just the host name.';
  if (/[A-Z]/.test(value)) return 'Use lowercase letters.';
  if (/\s/.test(value)) return 'Take out the spaces.';
  if (!value.includes('.')) return 'A host name has at least one dot, such as learn.broker.com.';
  if (value.endsWith('.')) return 'Leave out the dot at the end.';
  if (!HOSTNAME.test(value)) return 'Use only letters, digits, hyphens and dots, with no hyphen next to a dot.';
  return null;
}
