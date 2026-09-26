# Trader Academy Platform

Multi-tenant learning platform. Modules 1 and 2: the data boundary and
the backend that enforces it.

## What is here

    db/001_schema.sql      platform and tenant schema
    db/002_rls.sql         RLS policies, audit chaining, outbox functions
    db/003_platform_rls.sql RLS on platform courses, lessons, questions
    db/004_content_versions_rls.sql RLS on version snapshots, via the owning course
    db/005_request_path.sql resolve_tenant(), verify_certificate(), sessions
    db/006_attempt_lessons.sql attempts record their lesson; one open paper at a time
    db/007_pathway_and_branding.sql lesson prerequisites, XP, onboarding answers, branding
    db/tests/seed.sql      academies, courses and certificates for the proof tests
    db/tests/rls_proof.sql 51 assertions run as the unprivileged app role
    db/tests/migrate_fresh.sh proves npm run migrate builds a fresh database
    db/seed/demo.sql       the demo: three academies, the eleven-lesson curriculum
    db/tests/demo_seed.sh  proves the demo seed loads twice cleanly and is complete
    scripts/demo.sh        npm run demo

    src/config.ts               environment-backed configuration
    src/logger.ts               structured logging
    src/db/unitOfWork.ts        scoped unit of work, pinned client, SET LOCAL
    src/outbox/relay.ts         fair-share relay, backoff, dead letter queue
    src/ai/guardrails.ts        dual-layer ingress and egress guardrails
    src/domain/placement.ts     60/40 baseline, gates, check grading
    src/domain/papers.ts        server-drawn placement and check papers
    src/domain/serial.ts        random PA-XXXX-XXXX certificate serials
    src/domain/pathway.ts       lesson availability: the one rule behind every lock
    src/auth/                   scrypt passwords, RLS-backed sessions
    src/http/server.ts          Fastify: a public scope and a tenant scope
    src/http/tenantScope.ts     host -> academy, or 404; never a default
    src/http/routes/            the REST routes, one file per area
    src/http/routes/public/     certificate verification: no tenant, no session
    src/http/routes/pages.ts    GET / (branded client) and GET /verify/:serial
    src/http/brand.ts           brand tokens: allowlisted, validated, escaped

    web/index.html              the academy client, served per host at /
    web/verify.html             the public, unbranded verification page

    test/platform.test.ts       integration tests against a real database
    test/http.*.test.ts         the REST routes through app.inject()

## Running it

    createdb academy
    npm run migrate                                      # as the database owner
    psql academy -f db/tests/seed.sql
    psql academy -U app_user -f db/tests/rls_proof.sql   # 51 assertions

    npm install
    npm run build
    npm test                                             # 93 tests
    npm run test:migrate                                 # migrate a fresh database

### Connections

Three roles, three URLs. Each has a default that works on a local
PostgreSQL where your OS user is a superuser.

| Variable               | Role             | Used by                       | Default                          |
|------------------------|------------------|-------------------------------|----------------------------------|
| `OWNER_DATABASE_URL`   | database owner   | `npm run migrate`             | `postgres:///academy` (OS user)  |
| `DATABASE_URL`         | `app_user`       | request path, `npm run test:db` | see `src/config.ts`            |
| `CONTROL_DATABASE_URL` | `app_control`    | provisioning, outbox relay    | see `src/config.ts`              |

Migrations create schemas, extensions and the two application roles, so
they must run as the owner. `app_user` does not exist until
`002_rls.sql` creates it, and could not create a schema if it did.

The HTTP server (`npm start`) reads `HTTP_HOST`, `HTTP_PORT`,
`TRUST_PROXY`, `WEB_ROOT` (default `web`) and `DEV_INSECURE_COOKIE`. The request host alone decides the academy.
`TRUST_PROXY` is a comma-separated list of proxy addresses allowed to
forward the public host in `X-Forwarded-Host`; leave it empty unless
the server sits behind one, or any client could choose an academy.

Every tenant route is rate limited per client IP (300 a minute),
counted before the host is resolved, and login and certificate
verification have their own tighter limits (10 and 30 a minute).

## The local demo

    npm run demo          # build, migrate and seed academy_demo, then serve on :3000
    npm run demo:reset    # remove the demo learners; keep the academies and curriculum
    npm run test:demo-seed

The demo runs against its own database, `academy_demo`, never the test
database: its placement questions would otherwise join every test
learner's paper. It seeds three academies on `gtl.academy.test`,
`pocketfolio.academy.test` and `meridian.academy.test`, each with its own
brand tokens, and the prototype's curriculum as four courses, one per
tier: eleven lessons with their prerequisites, five knowledge-check
questions per lesson and eight placement questions, every option with a
rationale.

The script prints the `/etc/hosts` line the three hosts need and never
edits the file itself. It starts the server on 127.0.0.1 with
`DEV_INSECURE_COOKIE=1`, so the session cookie works over plain HTTP.

All lesson content is a draft: author "Draft, Global Tutoring Lab
curriculum", reviewer "Pending compliance review", no review date. It
must be read by a real person before any of it is presented as reviewed.

**Deferred from the demo:** badges (E17-F02, a Should) need rules the
server does not hold yet, so the demo shows none rather than letting the
browser award them. Coins are left out altogether.

## Deployment

**The two SECURITY DEFINER functions must be owned by a role that
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
- The limits are per client IP. Behind a proxy, every request carries
  the proxy's address unless `TRUST_PROXY` names it, which would put all
  users behind one counter.

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
