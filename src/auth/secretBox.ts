/**
 * Encryption at rest for small secrets such as TOTP seeds: AES-256-GCM,
 * a fresh 12-byte nonce per value, stored as base64 of nonce | tag | text.
 * The key is 32 bytes, base64, from CONSOLE_TOTP_KEY. A database dump
 * alone does not reveal anyone's second factor.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class SecretBoxKeyError extends Error {
  constructor() {
    super('CONSOLE_TOTP_KEY must be 32 bytes, base64-encoded');
    this.name = 'SecretBoxKeyError';
  }
}

export function keyFrom(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new SecretBoxKeyError();
  return key;
}

export function seal(plain: string, key: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const text = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), text]).toString('base64');
}

/** Throws if the value was tampered with or sealed under another key. */
export function open(sealed: string, key: Buffer): string {
  const raw = Buffer.from(sealed, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
