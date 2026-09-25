#!/bin/sh
# Proves `npm run migrate` builds a brand-new database from nothing.
#
# The migrations create schemas, extensions and the app roles, so they
# must run as the database owner. DATABASE_URL is deliberately pointed at
# app_user here: if migrate ever falls back to it, this test fails.
set -eu

db="academy_migrate_test_$$"
createdb "$db"
trap 'dropdb --if-exists "$db"' EXIT

PGOPTIONS="-c client_min_messages=warning" \
OWNER_DATABASE_URL="postgres:///$db" \
DATABASE_URL="postgres://app_user@/$db" \
  npm run --silent migrate >/dev/null

forced=$(psql "postgres:///$db" -tA -c "
  SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('app','platform') AND c.relrowsecurity AND c.relforcerowsecurity")

if [ "$forced" -lt 1 ]; then
  echo "FAIL  migrate ran but no table has RLS forced ($forced)" >&2
  exit 1
fi
echo "PASS  npm run migrate builds a fresh database as the owner ($forced tables with RLS forced)"
