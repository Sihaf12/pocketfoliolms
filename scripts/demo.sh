#!/bin/sh
# npm run demo: three branded academies on this machine, against their
# own database, so the test database is never touched.
#
#   DEMO_DATABASE   database name            (default academy_demo)
#   DEMO_PORT       HTTP port                (default 3000)
#   DEMO_PGHOST     Postgres socket directory (default /tmp)
#
# It builds, migrates, seeds, prints the /etc/hosts line, and starts the
# server on 127.0.0.1 with the development cookie switch on. It never
# edits /etc/hosts itself.
set -eu

DB="${DEMO_DATABASE:-academy_demo}"
PORT="${DEMO_PORT:-3000}"
SOCKET="${DEMO_PGHOST:-/tmp}"
HOSTS="gtl.academy.test pocketfolio.academy.test meridian.academy.test console.academy.test"
CONSOLE_HOST="console.academy.test"

# Every connection points at the demo database, whatever the shell exports.
export OWNER_DATABASE_URL="postgres:///$DB"
export DATABASE_URL="postgres://app_user@/$DB?host=$SOCKET"
export CONTROL_DATABASE_URL="postgres://app_control@/$DB?host=$SOCKET"
export STUDIO_DATABASE_URL="postgres://app_studio@/$DB?host=$SOCKET"
export CONSOLE_DATABASE_URL="postgres://app_console@/$DB?host=$SOCKET"

# The console's TOTP key for this machine, made once and kept out of git,
# so owners created for the demo can still sign in after a restart.
mkdir -p .demo
[ -s .demo/console.key ] || node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" > .demo/console.key
export CONSOLE_HOST
export CONSOLE_TOTP_KEY="$(cat .demo/console.key)"

if ! psql "$OWNER_DATABASE_URL" -c 'SELECT 1' >/dev/null 2>&1; then
  echo "Creating database $DB"
  createdb "$DB"
fi

echo "Building"
npm run --silent build

echo "Migrating $DB"
PGOPTIONS="-c client_min_messages=warning" npm run --silent migrate >/dev/null

echo "Seeding the demo academies"
PGOPTIONS="-c client_min_messages=warning" psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f db/seed/demo.sql

missing=""
for host in $HOSTS; do
  grep -Eq "^[^#]*[[:space:]]$host([[:space:]]|\$)" /etc/hosts || missing="$missing $host"
done

echo
echo "The academies need this line in /etc/hosts:"
echo
echo "  127.0.0.1 $HOSTS"
echo
if [ -n "$missing" ]; then
  echo "Not found yet for:$missing"
  echo "Add the missing ones with:  sudo sh -c 'echo \"127.0.0.1$missing\" >> /etc/hosts'"
else
  echo "All three hosts are already present."
fi
echo
echo "Then open:"
for host in $HOSTS; do
  echo "  http://$host:$PORT/"
done
echo
echo "The platform console answers at http://$CONSOLE_HOST:$PORT/api/console."
echo "Create its first owner with:  CONSOLE_TOTP_KEY=\$(cat .demo/console.key) CONSOLE_DATABASE_URL=$CONSOLE_DATABASE_URL npm run console:create-owner -- --email you@example.com --name \"Your Name\""
echo
echo "Sessions are per academy: signing up at one does not sign you in at another."
echo "Reset the demo learners with: npm run demo:reset"
echo

exec env NODE_ENV=development DEV_INSECURE_COOKIE=1 CONSOLE_HOST="$CONSOLE_HOST" HTTP_HOST=127.0.0.1 HTTP_PORT="$PORT" node dist/src/http/main.js
