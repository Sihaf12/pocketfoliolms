# Trader Academy Platform

Multi-tenant learning platform: the data boundary, the backend that
enforces it, the learner app (Module 4b), and (Module 4a) the content studio and
platform console as a Next.js front end.

## What is here

    db/001_schema.sql      platform and tenant schema
    db/002_rls.sql         RLS policies, audit chaining, outbox functions
    db/003_platform_rls.sql RLS on platform courses, lessons, questions
    db/004_content_versions_rls.sql RLS on version snapshots, via the owning course
    db/005_request_path.sql resolve_tenant(), verify_certificate(), sessions
    db/006_attempt_lessons.sql attempts record their lesson; one open paper at a time
    db/007_pathway_and_branding.sql lesson prerequisites, XP, onboarding answers, branding
    db/008_studio.sql      studio and console roles, the review workflow, staff, brand contract
    db/009_studio_identity.sql studio roles as a set, staff invitations, TOTP replay guard
    db/010_academy_settings.sql the studio's five functions for brand, domain and CRM settings
    db/011_entitlements.sql which platform courses each academy may offer, enforced on the catalogue
    db/012_google_signin.sql Google sign-in for learners: sign-in states and handoff codes
    db/tests/seed.sql      academies, courses and certificates for the proof tests
    db/tests/rls_proof.sql 59 assertions run as the unprivileged app role
    db/tests/migrate_fresh.sh proves npm run migrate builds a fresh database
    db/tests/studio_proof.sql proves the studio and console roles and the review workflow
    db/seed/demo.sql       the demo: three academies, the eleven-lesson curriculum
    db/tests/demo_seed.sh  proves the demo seed loads twice cleanly and is complete
    scripts/demo.sh        npm run demo

    src/config.ts               environment-backed configuration
    src/logger.ts               structured logging
    src/db/unitOfWork.ts        scoped unit of work, pinned client, SET LOCAL
    src/outbox/relay.ts         fair-share relay, backoff, dead letter queue
    src/outbox/health.ts        queue health and dead-letter replay, for the studio and the console
    src/net/address.ts          which addresses a CRM delivery may never reach
    src/ai/guardrails.ts        dual-layer ingress and egress guardrails
    src/domain/placement.ts     60/40 baseline, gates, check grading
    src/domain/papers.ts        server-drawn placement and check papers
    src/domain/serial.ts        random PA-XXXX-XXXX certificate serials
    src/domain/pathway.ts       lesson availability: the one rule behind every lock
    src/domain/review.ts        the content review workflow and its separation rule
    packages/shared/            brand contract, contrast checks, lesson Markdown: one copy for API and studio
    src/http/server.ts          Fastify: a public scope and a tenant scope
    src/http/tenantScope.ts     host -> academy, or 404; never a default
    src/http/routes/            the REST routes, one file per area
    src/http/routes/public/     certificate verification: no tenant, no session
    src/http/brand.ts           brand tokens, as the API reads them (the contract is packages/shared)
    src/http/forwarding.ts      public host and client IP; forwarded headers need the front end's secret
    src/http/studioScope.ts     /api/studio: studio sessions, role sets, app_studio
    src/http/consoleScope.ts    /api/console: its own host only, staff sessions, app_console
    src/auth/                   passwords, sessions, TOTP (RFC 6238), secrets sealed at rest
    src/cli/createOwner.ts      npm run console:create-owner
    src/content/                the content workflow: drafts, review, publishing into live rows
    src/http/routes/content.ts  content routes, registered in the studio and the console


    test/platform.test.ts       integration tests against a real database
    test/http.*.test.ts         the REST routes through app.inject()

    studio/                     Next.js: the learner app, the academy studio and the platform console
    studio/app/(learner)/       the learner app, from design/learner-journey.html (Module 4b)
    studio/app/(staff)/         the studio (/studio) and the console (its own host)
    studio/proxy.ts             which host gets which pages: studio on academies, console on its host
    studio/app/api/[...path]    every /api request, forwarded to Fastify with the shared secret
    studio/components/LessonPreview.tsx  the lesson as a learner reads it, via packages/shared
    src/studio/server.ts        the front end's edge server: drops client forwarded headers
    src/cli/demoTeam.ts         npm run demo:team and demo:code
    e2e/                        Playwright: every screen, both academies, phone and desktop

## Running it

    createdb academy
    npm run migrate                                      # as the database owner
    psql academy -f db/tests/seed.sql
    psql academy -U app_user -f db/tests/rls_proof.sql   # 59 assertions

    npm install
    npm run build
    npm test                                             # 177 tests
    npm run test:migrate                                 # migrate a fresh database
    npm run test:studio                                  # studio and console roles, review workflow (75)
    npm run typecheck                                    # the API, the studio and the end-to-end specs
    npx playwright install chromium                      # once
    npm run test:e2e                                     # 86 browser tests, on academy_e2e

### Connections

Five roles, five URLs. Each has a default that works on a local
PostgreSQL where your OS user is a superuser.

| Variable               | Role             | Used by                       | Default                          |
|------------------------|------------------|-------------------------------|----------------------------------|
| `OWNER_DATABASE_URL`   | database owner   | `npm run migrate`             | `postgres:///academy` (OS user)  |
| `DATABASE_URL`         | `app_user`       | learner routes, `npm run test:db` | see `src/config.ts`          |
| `STUDIO_DATABASE_URL`  | `app_studio`     | the academy studio            | see `src/config.ts`              |
| `CONSOLE_DATABASE_URL` | `app_console`    | the platform console          | see `src/config.ts`              |
| `CONTROL_DATABASE_URL` | `app_control`    | the outbox relay              | see `src/config.ts`              |

Migrations create schemas, extensions and the two application roles, so
they must run as the owner. `app_user` does not exist until
`002_rls.sql` creates it, and could not create a schema if it did.

The HTTP server (`npm start`) reads `HTTP_HOST`, `HTTP_PORT`,
`PROXY_SECRET`, `CONSOLE_HOST`, `CONSOLE_TOTP_KEY` and `DEV_INSECURE_COOKIE`.

- **The host decides the academy.** Forwarded headers (`X-Forwarded-Host`,
  `-For`, `-Proto`, `Forwarded`) are believed only when the request also
  carries `X-Academy-Proxy-Secret` equal to `PROXY_SECRET`, which the
  Next.js front end sends. A wrong secret is refused with a 400. Forwarded
  headers with no secret are ignored: the `Host` header and the socket
  address decide, and a warning is logged once per process so the setup
  can be put right.
- **The console answers on `CONSOLE_HOST` only**, at `/api/console`. Empty
  disables it. The server refuses to start if that host is an academy's
  primary domain. `CONSOLE_TOTP_KEY` (32 bytes, base64) encrypts staff
  TOTP secrets at rest.
- **The first platform owner** is made with
  `npm run console:create-owner -- --email … --name …`, which prints the
  password and TOTP secret once. The owner role cannot be invited.
- **A domain change needs a DNS TXT record.** The academy asks for a new
  domain in the studio and is given a record to add at
  `_academy-challenge.<domain>`; the domain moves when the record is
  found. The platform owner can apply a waiting change without it from
  the console, with a reason. Both are audited.
- **CRM deliveries go to public addresses only.** The endpoint must be
  https. Loopback, private, link-local (cloud metadata), carrier-grade
  NAT and multicast addresses are refused when the endpoint is saved
  and again at delivery, inside the connection's own DNS lookup, so a
  name that later resolves somewhere internal is still refused.
  Redirects are not followed.

Every tenant route is rate limited per client IP (300 a minute),
counted before the host is resolved, and login and certificate
verification have their own tighter limits (10 and 30 a minute).

## The local demo

    npm run demo          # build, migrate and seed academy_demo, then serve on :3100 (API on :3000)
    npm run demo:code     # the console owner's current sign-in code
    npm run demo:reset    # remove the demo learners; keep the academies, curriculum and team
    npm run test:demo-seed

The demo runs against its own database, `academy_demo`, never the test
database: its placement questions would otherwise join every test
learner's paper. It seeds three academies on `gtl.academy.test`,
`pocketfolio.academy.test` and `meridian.academy.test`, each with its own
brand tokens, and the prototype's curriculum as four courses, one per
tier: eleven lessons with their prerequisites, five knowledge-check
questions per lesson and eight placement questions, every option with a
rationale.

The script prints the `/etc/hosts` line the four hosts need (the three
academies and `console.academy.test`) and never edits the file itself.
It starts Fastify on 127.0.0.1:3000 and the Next.js front end on
127.0.0.1:3100, which is what you open, with `DEV_INSECURE_COOKIE=1` so
session cookies work over plain HTTP. The two share a secret made once in
`.demo/proxy.secret`.

With `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
`AUTH_CALLBACK_HOST=localhost:3100` in `.env`, the academies' sign-in and
sign-up pages offer Continue with Google (see Deployment). Without them
the button is not shown.

It also makes a demo team (`src/cli/demoTeam.ts`): admin@, author@,
reviewer@ and compliance@ each academy's domain, one role each because
the separation rule counts people, and owner@, author@, reviewer@ and
compliance@ `console.academy.test`. They share one generated password,
kept with the owner's TOTP secret in `.demo/team.json` (git-ignored,
mode 600). The owner signs in with a code from `npm run demo:code`, and
each code works once.

`npm run test:e2e` runs the same script against `academy_e2e` on ports
3201 and 3301, with the per-address rate limits lifted
(`RATE_TENANT_PER_MIN`, `RATE_LOGIN_PER_MIN`, `RATE_CONSOLE_PER_MIN`),
because every request it makes comes from 127.0.0.1. Chromium maps
`*.academy.test` to this machine itself, so it needs no `/etc/hosts`
entries. Screenshots of every screen land in `test-results/screens/`.

All lesson content is a draft: author "Draft, Global Tutoring Lab
curriculum", reviewer "Pending compliance review", no review date. It
must be read by a real person before any of it is presented as reviewed.

**Deferred from the demo:** badges (E17-F02, a Should) need rules the
server does not hold yet, so the demo shows none rather than letting the
browser award them. Coins are left out altogether.

## Deployment

**Every SECURITY DEFINER function must be owned by a role that
bypasses RLS.** `app.resolve_tenant()` and `app.verify_certificate()`
read `app.tenants` and `app.certificates`, which have RLS forced. A
function runs as its owner, and under `FORCE ROW LEVEL SECURITY` an
owner without `BYPASSRLS` (or superuser) sees no rows: every host would
answer `unknown_academy` and every certificate 404. It fails closed, not
open, but it takes the whole platform down. Run migrations as that role
(`OWNER_DATABASE_URL`), never as `app_user` or `app_control`, and check
with:

    SELECT p.proname, r.rolname, r.rolsuper OR r.rolbypassrls AS bypasses_rls
      FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
     WHERE p.proname IN ('resolve_tenant', 'verify_certificate');

The SQL proof asserts this too.

**The host cache and the rate-limit counters live in each process.**
Nothing is shared between instances:

- A resolved host is cached for 30 seconds and an unknown host for 5,
  per process. `forgetResolvedHosts()` clears only the process that
  calls it, so after a domain moves or an academy is suspended, other
  instances can keep serving the old answer for up to 30 seconds, and a
  newly provisioned academy can take up to 5 seconds to appear.
- Each instance counts its own requests, so N instances behind a load
  balancer allow up to N times each limit. A shared store (Redis, for
  `@fastify/rate-limit`) is needed before the limits mean the same thing
  at scale.
- The limits are per client IP: the socket's, or `X-Forwarded-For` when
  it arrived with the front end's secret.

**The session cookie is `Secure`, so browsers only send it over HTTPS.**
Academies are served on real domain names (the resolver rejects
`localhost` and bare IPs), so trying one locally over plain HTTP, say
`learn.northgate.ae` mapped in `/etc/hosts`, will sign in and then lose
the session on the next request. For local use,
`DEV_INSECURE_COOKIE=1` drops `Secure` (the cookie stays `HttpOnly`,
`SameSite=Lax` and host-only) and logs a warning at start. The server
refuses to start if it is set while `NODE_ENV=production`. Anywhere
else, put a TLS-terminating proxy in front instead. The API tests are
unaffected: they use `app.inject()` and send the cookie header directly.

**Google sign-in for learners** is on when `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` and `AUTH_CALLBACK_HOST` are set. Every academy
returns from Google to one platform-owned host, `AUTH_CALLBACK_HOST`,
at `/api/auth/google/callback`, so Google needs one redirect URI for
all of them. That host must point at the front end like any academy,
and must not be an academy's domain or the console's; the server
refuses to start if it is.

- **Production requires https for the callback host.** The server builds
  the redirect URI as `https://<AUTH_CALLBACK_HOST>/api/auth/google/callback`
  for any host other than localhost, and Google rejects plain http
  redirects except for localhost.
- **Plain http is for development only**, and only for
  `localhost[:port]`: `AUTH_CALLBACK_HOST=localhost:3100` gives
  `http://localhost:3100/api/auth/google/callback`. The server refuses to
  start with a localhost callback host while `NODE_ENV=production`.
- Only learners sign in this way. An email that belongs to an account
  holding any studio role is refused, and nothing is linked. An existing
  learner with the same email is linked: the password is cleared and the
  learner's other sessions end. Both are audited.
- `npm run demo` reads `.env` (or `DEMO_ENV_FILE`). The e2e run never
  reads it; it plays Google with a local stand-in.

## Backlog: before production

- **The Next.js edge server trusts only its socket.** It drops every
  forwarded header a client sends and records the socket's address, so
  a load balancer or TLS terminator in front of it would be recorded as
  every client. Before production, either Next.js is the edge, or it
  learns to trust exactly one proxy in front of it.

- **TLS provisioning must be tied to domain changes.** Today a verified
  or overridden domain change switches `primary_domain` at once and
  leaves `tls_state` as it was, so the new host serves without a
  certificate until one is issued outside this code. Before production,
  a domain change has to issue the certificate for the new host (and
  keep the old host answering until it is live), and record the result
  in `tls_state` and `tls_expires_at`.

## Temporary rules

- **Certificate issuance.** A certificate is issued when a course reaches
  100%: every lesson in it has a passed knowledge check. It is written in
  the same transaction as the check that completed the course, with
  `certificate.issued` keyed `cert:{userId}:{courseId}`. E14-F02 course
  assessments will replace this trigger.

## The three decisions worth knowing

**Isolation is enforced by the database, not by application code.**
Every tenant table has RLS enabled and forced, with policies comparing
`tenant_id` to `app.current_tenant()`. That function returns NULL when
the setting is absent or blank, so a query without a tenant returns zero
rows rather than raising or, worse, returning everything. A forgotten
filter fails safe.

**The tenant is applied with SET LOCAL inside an explicit transaction,
on a pinned client.** With transaction pooling, a session-scoped setting
would survive into the next borrower of that connection. Here it expires
at COMMIT, every query in a request shares one client (so `Promise.all`
cannot fan out across the pool), and the connection is reset on release.

**Events are written in the same transaction as the record they
describe.** If the transaction rolls back, the event goes with it, so
the two can never disagree. A separate relay delivers them with
fair-share scheduling per tenant, exponential backoff, an idempotency
key on every request, and a dead letter queue after the configured
attempts.
