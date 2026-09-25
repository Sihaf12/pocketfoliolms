/**
 * Certificate serials: PA-XXXX-XXXX from crypto randomness.
 *
 * Crockford base32 leaves out I, L, O and U, so a serial read off paper
 * or over the phone cannot be misread. Eight characters give 40 bits:
 * too many to enumerate through a rate-limited public endpoint. The same
 * format is enforced by ck_certificates_serial in the database.
 */
import { randomInt } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const SERIAL_PATTERN = /^PA-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

function group(): string {
  let out = '';
  for (let i = 0; i < 4; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export function newCertificateSerial(): string {
  return `PA-${group()}-${group()}`;
}
