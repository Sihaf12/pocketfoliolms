# Trader Academy Platform

Multi-tenant learning platform. Each broker gets a branded academy on one engine.

## Non-negotiables
- Tenant isolation is enforced by Postgres RLS, never by application code.
  Never add a manual `WHERE tenant_id = ...` as the primary guard.
- All request-path database work goes through `withTenant()` in
  src/db/unitOfWork.ts. Never use the pool directly in a route handler.
- Outbox events are written inside the same transaction as the record they
  describe, via `db.enqueue()`. Never emit an event after a commit.
- AI coach output passes `inspectEgress()` before anything reaches a client.
  No exceptions, no streaming around it.
- Placement is `placement * 0.6 + self_rating * 0.4`. Gates: Apply at
  Learn >= 50, Specialise at Learn >= 70 and Safeguard >= 50.
- A knowledge check passes at 2 of 3. That event is the North Star metric.

## Commands
- `npm test` runs 72 tests. Run it before saying anything is done.
- `psql academy -U app_user -f db/tests/rls_proof.sql` proves isolation (42 PASS).
- `npm run test:migrate` proves the migrations build a fresh database as the
  owner (OWNER_DATABASE_URL, default: your OS user on `academy`).
- Migrations are forward-only files in db/. Never edit an applied migration.

## House style
- TypeScript strict. No `any`. Comments explain intent, not mechanics.
- A new tenant table means: tenant_id column, RLS enabled AND forced, a
  policy, and a test proving another tenant cannot read it.
