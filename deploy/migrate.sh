#!/bin/sh
# The migrate step, run in its own container before the new API starts.
# A failure here stops the deploy while the old app keeps serving.
#
#   1. every migration (idempotent, forward-only)
#   2. the request roles' passwords, from deploy/.env
#   3. the demo seed: only when the demo academies are missing, or with RESEED=1,
#      because re-seeding puts seeded lessons back and undoes studio edits to them
#   4. the demo team (idempotent; kept in the demo volume's team.json)
set -eu
: "${OWNER_DATABASE_URL:?}" "${DEMO_DOMAIN:?}"
export PGOPTIONS="-c client_min_messages=warning"
psql_() { psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"; }

echo "Migrating"
npm run --silent migrate >/dev/null

echo "Setting the request roles' passwords"
psql_ -v app_user="${APP_USER_PASSWORD:?}" -v app_control="${APP_CONTROL_PASSWORD:?}" \
      -v app_studio="${APP_STUDIO_PASSWORD:?}" -v app_console="${APP_CONSOLE_PASSWORD:?}" \
      -f deploy/role_passwords.sql

# psql substitutes variables in a script, not in -c, so the query comes on stdin.
seeded=$(echo "SELECT count(*) FROM app.tenants WHERE primary_domain LIKE '%.' || :'domain';" \
  | psql_ -tA -v domain="$DEMO_DOMAIN")
if [ "${RESEED:-0}" = 1 ] || [ "$seeded" -eq 0 ]; then
  echo "Seeding the demo academies on *.$DEMO_DOMAIN"
  psql_ -v demo_domain="$DEMO_DOMAIN" -f db/seed/demo.sql
else
  echo "Demo academies already seeded ($seeded); RESEED=1 seeds again"
fi

echo "Making the demo team"
node dist/src/cli/demoTeam.js
