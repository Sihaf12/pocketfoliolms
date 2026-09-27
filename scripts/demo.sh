#!/bin/sh
# npm run demo: three branded academies, their studios and the platform
# console on this machine, against their own database, so the test
# database is never touched.
#
#   DEMO_DATABASE      database name              (default academy_demo)
#   DEMO_PORT          Fastify, the API           (default 3000)
#   DEMO_STUDIO_PORT   Next.js, what you open     (default 3100)
#   DEMO_PGHOST        Postgres socket directory  (default /tmp)
#   DEMO_DIR           keys and the demo team     (default .demo)
#   DEMO_ENV_FILE      your own settings          (default .env)
#   DEMO_FAKE_GOOGLE_PORT  a local stand-in for Google, for the e2e run
#
# Google sign-in is on when the settings file gives GOOGLE_CLIENT_ID,
# GOOGLE_CLIENT_SECRET and AUTH_CALLBACK_HOST (localhost:3100 here).
#
# It builds, migrates, seeds, makes the demo team, prints the /etc/hosts
# line, and starts both servers on 127.0.0.1 with the development cookie
# switch on. It never edits /etc/hosts itself.
set -eu

DB="${DEMO_DATABASE:-academy_demo}"
PORT="${DEMO_PORT:-3000}"
STUDIO_PORT="${DEMO_STUDIO_PORT:-3100}"
SOCKET="${DEMO_PGHOST:-/tmp}"
export DEMO_DIR="${DEMO_DIR:-.demo}"
CONSOLE_HOST="console.academy.test"
HOSTS="gtl.academy.test pocketfolio.academy.test meridian.academy.test $CONSOLE_HOST"

# Your settings first, so everything below wins over them.
ENV_FILE="${DEMO_ENV_FILE:-.env}"
case "$ENV_FILE" in /*) ;; *) ENV_FILE="./$ENV_FILE" ;; esac
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

# Every connection points at the demo database, whatever the shell exports.
export OWNER_DATABASE_URL="postgres:///$DB"
export DATABASE_URL="postgres://app_user@/$DB?host=$SOCKET"
export CONTROL_DATABASE_URL="postgres://app_control@/$DB?host=$SOCKET"
export STUDIO_DATABASE_URL="postgres://app_studio@/$DB?host=$SOCKET"
export CONSOLE_DATABASE_URL="postgres://app_console@/$DB?host=$SOCKET"

# The console's TOTP key and the front end's shared secret, made once per
# machine and kept out of git.
mkdir -p "$DEMO_DIR"
newkey() { node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"; }
[ -s "$DEMO_DIR/console.key" ] || newkey > "$DEMO_DIR/console.key"
[ -s "$DEMO_DIR/proxy.secret" ] || newkey > "$DEMO_DIR/proxy.secret"
chmod 600 "$DEMO_DIR/console.key" "$DEMO_DIR/proxy.secret"
export CONSOLE_HOST
export CONSOLE_TOTP_KEY="$(cat "$DEMO_DIR/console.key")"
export PROXY_SECRET="$(cat "$DEMO_DIR/proxy.secret")"

if ! psql "$OWNER_DATABASE_URL" -c 'SELECT 1' >/dev/null 2>&1; then
  echo "Creating database $DB"
  createdb "$DB"
fi

echo "Building the API"
npm run --silent build
echo "Building the studio"
npx next build studio >/dev/null

echo "Migrating $DB"
PGOPTIONS="-c client_min_messages=warning" npm run --silent migrate >/dev/null

echo "Seeding the demo academies"
PGOPTIONS="-c client_min_messages=warning" psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f db/seed/demo.sql
node dist/src/cli/demoTeam.js

missing=""
for host in $HOSTS; do
  grep -Eq "^[^#]*[[:space:]]$host([[:space:]]|\$)" /etc/hosts || missing="$missing $host"
done

echo
echo "The academies and the console need this line in /etc/hosts:"
echo
echo "  127.0.0.1 $HOSTS"
echo
if [ -n "$missing" ]; then
  echo "Not found yet for:$missing"
  echo "Add the missing ones with:  sudo sh -c 'echo \"127.0.0.1$missing\" >> /etc/hosts'"
else
  echo "All four hosts are already present."
fi
echo
echo "Then open:"
for host in gtl.academy.test pocketfolio.academy.test meridian.academy.test; do
  echo "  http://$host:$STUDIO_PORT/          the academy"
  echo "  http://$host:$STUDIO_PORT/studio    its studio"
done
echo "  http://$CONSOLE_HOST:$STUDIO_PORT/    the platform console"
echo
echo "Sign-in details: $DEMO_DIR/team.json. The console owner's code: npm run demo:code"
echo "Reset the demo learners with: npm run demo:reset"
echo

# The e2e run signs in through a stand-in for Google, never the real one.
FAKE=""
if [ -n "${DEMO_FAKE_GOOGLE_PORT:-}" ]; then
  export GOOGLE_CLIENT_ID="e2e-client.apps.googleusercontent.test" GOOGLE_CLIENT_SECRET="e2e-secret"
  export AUTH_CALLBACK_HOST="localhost:$STUDIO_PORT" GOOGLE_ISSUER="http://127.0.0.1:$DEMO_FAKE_GOOGLE_PORT"
  export GOOGLE_AUTHORIZE_URL="$GOOGLE_ISSUER/authorize" GOOGLE_TOKEN_URL="$GOOGLE_ISSUER/token" GOOGLE_JWKS_URL="$GOOGLE_ISSUER/jwks"
  node dist/test/fakeGoogleServer.js &
  FAKE=$!
fi
if [ -n "${GOOGLE_CLIENT_ID:-}" ] && [ -n "${AUTH_CALLBACK_HOST:-}" ]; then
  echo "Google sign-in is on, returning to http://$AUTH_CALLBACK_HOST/api/auth/google/callback"
else
  echo "Google sign-in is off: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and AUTH_CALLBACK_HOST in $ENV_FILE"
fi
echo

# The API in the background, stopped with this script; the studio in front.
env NODE_ENV=development DEV_INSECURE_COOKIE=1 HTTP_HOST=127.0.0.1 HTTP_PORT="$PORT" node dist/src/http/main.js &
API=$!
trap 'kill $API $FAKE 2>/dev/null' EXIT INT TERM
exec env NODE_ENV=production STUDIO_PORT="$STUDIO_PORT" BACKEND_URL="http://127.0.0.1:$PORT" PUBLIC_PROTO=http \
  node dist/src/studio/server.js
