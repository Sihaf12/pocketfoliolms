/**
 * Provisions a platform owner:
 *
 *   npm run console:create-owner -- --email owner@example.com --name "Ada Owner"
 *
 * The owner role cannot be invited, because an owner must hold TOTP from
 * the moment the account exists. This generates the password and the TOTP
 * secret, stores the secret encrypted under CONSOLE_TOTP_KEY, records the
 * provisioning in the platform audit log, and prints both once. Neither
 * can be shown again.
 */
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { keyFrom, seal } from '../auth/secretBox.js';
import { newTotpSecret, otpauthUri } from '../auth/totp.js';
import { shutdown, withConsole } from '../db/unitOfWork.js';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const email = arg('email')?.trim().toLowerCase();
const name = arg('name')?.trim();
if (!email || !name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: npm run console:create-owner -- --email owner@example.com --name "Ada Owner"');
  process.exit(2);
}

const key = keyFrom(config.console.totpKey);
const password = randomBytes(18).toString('base64url');
const secret = newTotpSecret();

try {
  await withConsole({ actor: 'cli:create-owner' }, async (db) => {
    const taken = await db.maybeOne('SELECT 1 FROM platform.staff WHERE email = $1', [email]);
    if (taken) throw new Error(`${email} already has a staff account.`);
    const staff = await db.one<{ id: string }>(
      `INSERT INTO platform.staff (email, display_name, role, password_hash, totp_secret)
       VALUES ($1, $2, 'platform_owner', $3, $4) RETURNING id`,
      [email, name, await hashPassword(password), seal(secret, key)],
    );
    await db.audit({ action: 'staff.owner_provisioned', entityType: 'staff', entityId: staff.id, payload: { email } });
  });
  console.log(`Platform owner created for ${email}. This is the only time these are shown.\n`);
  console.log(`  Password     ${password}`);
  console.log(`  TOTP secret  ${secret}`);
  console.log(`  TOTP URI     ${otpauthUri(secret, email)}\n`);
  console.log('Add the secret to an authenticator app, then sign in to the console with a code from it.');
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await shutdown();
}
