/**
 * A studio team for each demo academy, and platform staff for the
 * console, so both can be opened in a browser straight away:
 *
 *   npm run demo:team        make or refresh the team
 *   npm run demo:code        the owner's current console code
 *
 * Demo and end-to-end databases only: it refuses any database whose name
 * does not end in _demo or _e2e. Everyone shares one generated password,
 * kept with the owner's TOTP secret in .demo/team.json (git-ignored,
 * readable by you alone). Running it again resets the team to that file.
 *
 * Per academy (*.academy.test): admin@, author@, reviewer@ and
 * compliance@ its domain, one role each, because the separation rule
 * counts people. On the console host: owner@ (with TOTP), author@,
 * reviewer@ and compliance@.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { hashPassword } from '../auth/password.js';
import { keyFrom, seal } from '../auth/secretBox.js';
import { newTotpSecret, stepOf, totpAt } from '../auth/totp.js';
import { config } from '../config.js';

interface Team {
  password: string;
  consoleHost: string;
  owner: { email: string; totpSecret: string };
  academies: { domain: string; name: string; people: { email: string; role: string }[] }[];
  staff: { email: string; role: string }[];
}

const dir = process.env.DEMO_DIR ?? '.demo';
const file = join(dir, 'team.json');
const STUDIO = [['admin', 'tenant_admin'], ['author', 'author'], ['reviewer', 'reviewer'], ['compliance', 'compliance']] as const;
const STAFF = [['author', 'platform_author'], ['reviewer', 'platform_reviewer'], ['compliance', 'platform_compliance']] as const;
const title = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function readTeam(): Team | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Team) : null;
}

async function makeTeam(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.OWNER_DATABASE_URL ?? 'postgres:///academy_demo', max: 1 });
  try {
    const db = (await pool.query<{ name: string }>('SELECT current_database() AS name')).rows[0]!.name;
    if (!/_(demo|e2e)$/.test(db)) throw new Error(`Refusing to make a demo team in ${db}: only *_demo and *_e2e databases.`);

    const consoleHost = config.console.host;
    if (!consoleHost) throw new Error('CONSOLE_HOST is not set.');
    const previous = readTeam();
    const password = previous?.password ?? randomBytes(12).toString('base64url');
    const totpSecret = previous?.owner.totpSecret ?? newTotpSecret();
    const hash = await hashPassword(password);

    const academies = (await pool.query<{ id: string; name: string; domain: string }>(
      `SELECT id, name, primary_domain AS domain FROM app.tenants WHERE primary_domain LIKE '%.academy.test' ORDER BY name`)).rows;
    const team: Team = { password, consoleHost, owner: { email: `owner@${consoleHost}`, totpSecret }, academies: [], staff: [] };

    for (const a of academies) {
      const people: Team['academies'][number]['people'] = [];
      for (const [who, role] of STUDIO) {
        const email = `${who}@${a.domain}`;
        await pool.query(
          `INSERT INTO app.users (tenant_id, email, display_name, password_hash, studio_roles)
           VALUES ($1, $2, $3, $4, ARRAY[$5]::text[])
           ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash, studio_roles = EXCLUDED.studio_roles`,
          [a.id, email, `${title(who)} at ${a.name}`, hash, role]);
        people.push({ email, role });
      }
      await pool.query('INSERT INTO app.tenant_settings (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING', [a.id]);
      team.academies.push({ domain: a.domain, name: a.name, people });
    }

    const sealed = seal(totpSecret, keyFrom(config.console.totpKey));
    await pool.query(
      `INSERT INTO platform.staff (email, display_name, role, password_hash, totp_secret)
       VALUES ($1, 'Platform Owner', 'platform_owner', $2, $3)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, totp_secret = EXCLUDED.totp_secret,
                                         totp_last_step = NULL, disabled_at = NULL`,
      [team.owner.email, hash, sealed]);
    for (const [who, role] of STAFF) {
      const email = `${who}@${consoleHost}`;
      await pool.query(
        `INSERT INTO platform.staff (email, display_name, role, password_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, disabled_at = NULL`,
        [email, `Platform ${title(who)}`, role, hash]);
      team.staff.push({ email, role });
    }

    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(team, null, 2)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    console.log(`Demo team ready in ${db}. Emails, the shared password and the owner's TOTP secret are in ${file}.`);
    console.log('The owner signs in to the console with a code: npm run demo:code');
  } finally {
    await pool.end();
  }
}

function printCode(): void {
  const team = readTeam();
  if (!team) throw new Error(`No ${file} yet. Run npm run demo:team first.`);
  const now = Date.now() / 1000;
  const left = 30 - Math.floor(now % 30);
  console.log(`${totpAt(team.owner.totpSecret, stepOf(now))}  (for ${team.owner.email}; ${left} seconds left, each code works once)`);
}

try {
  if (process.argv.includes('--code')) printCode();
  else await makeTeam();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
