# Trader Academy Platform

Multi-tenant learning platform. Modules 1 and 2: the data boundary and
the backend that enforces it.

## What is here

    db/001_schema.sql      platform and tenant schema
    db/002_rls.sql         RLS policies, audit chaining, outbox functions
    db/003_platform_rls.sql RLS on platform courses, lessons, questions
    db/004_content_versions_rls.sql RLS on version snapshots, via the owning course
    db/tests/seed.sql      two academies and a course, for the proof tests
    db/tests/rls_proof.sql 24 assertions run as the unprivileged app role
    db/tests/migrate_fresh.sh proves npm run migrate builds a fresh database

    src/config.ts               environment-backed configuration
    src/logger.ts               structured logging
    src/db/unitOfWork.ts        scoped unit of work, pinned client, SET LOCAL
    src/outbox/relay.ts         fair-share relay, backoff, dead letter queue
    src/ai/guardrails.ts        dual-layer ingress and egress guardrails
    src/domain/placement.ts     60/40 baseline, gates, check grading

    test/platform.test.ts       19 integration tests against a real database

## Running it

    createdb academy
    npm run migrate                                      # as the database owner
    psql academy -f db/tests/seed.sql
    psql academy -U app_user -f db/tests/rls_proof.sql   # 24 assertions

    npm install
    npm run build
    npm test                                             # 19 tests
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
