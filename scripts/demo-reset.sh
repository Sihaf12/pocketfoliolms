#!/bin/sh
# npm run demo:reset: remove every learner from the demo academies, with
# their sessions, attempts, enrolments, certificates and events. The
# academies, the curriculum and the studio team stay. Only ever touches the demo database.
set -eu

DB="${DEMO_DATABASE:-academy_demo}"

psql "postgres:///$DB" -v ON_ERROR_STOP=1 -q <<'SQL'
BEGIN;
DELETE FROM app.outbox_events
 WHERE tenant_id IN (SELECT id FROM app.tenants WHERE primary_domain LIKE '%.academy.test');
DELETE FROM app.users
 WHERE tenant_id IN (SELECT id FROM app.tenants WHERE primary_domain LIKE '%.academy.test')
   AND cardinality(studio_roles) = 0;
COMMIT;
SQL

echo "Demo learners removed from $DB."
