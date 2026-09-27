#!/bin/sh
# Deploys main to staging: pull, build, migrate, restart.
#
#   deploy/deploy.sh             the usual deploy
#   deploy/deploy.sh --reseed    also re-seed the demo academies, which puts
#                                seeded lessons back as the repository has them
#
# Postgres is started if it is stopped and otherwise left alone: a deploy
# never restarts it. The old app keeps serving while the image builds and
# the migrations run; a failure in either stops here with the old app up.
# The API and relay then restart, and the front end last, while Caddy holds
# requests for up to 20 seconds.
#
# Each build is tagged with its commit, and academy-app:current is the one
# running. The last five builds are kept for rolling back.
set -eu
cd "$(dirname "$0")/.."

BRANCH="${DEPLOY_BRANCH:-main}"
RESEED=0
for arg in "$@"; do
  case "$arg" in
    --reseed) RESEED=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

ENV_FILE=deploy/.env
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE is missing: see review/staging.md" >&2; exit 1; }
[ "$(stat -c %a "$ENV_FILE")" = 600 ] || { echo "$ENV_FILE must be mode 600" >&2; exit 1; }
C="docker compose -f deploy/compose.yml --env-file $ENV_FILE"
DOMAIN="$(sed -n 's/^STAGING_DOMAIN=//p' "$ENV_FILE")"

echo "== Pulling $BRANCH"
git fetch --prune origin
git checkout --quiet --detach "origin/$BRANCH"
TAG="$(git rev-parse --short=12 HEAD)"
PREVIOUS="$(cat deploy/.deployed 2>/dev/null || echo none)"

echo "== Building academy-app:$TAG"
APP_TAG="$TAG" $C build migrate

echo "== Postgres"
$C up -d --wait db

echo "== Migrating"
APP_TAG="$TAG" RESEED="$RESEED" $C run --rm migrate

echo "== Restarting the app"
docker tag "academy-app:$TAG" academy-app:current
$C up -d --no-deps --wait api relay
$C up -d --no-deps --wait frontend
$C up -d --no-deps caddy
$C exec -T caddy caddy reload --config /etc/caddy/Caddyfile

echo "== Checking"
fetch() { curl -sS --max-time 60 --retry 3 --retry-all-errors -o /dev/null -w '%{http_code}' "$@"; }
expect() { got="$(fetch "$2")"; [ "$got" = "$1" ] || { echo "FAIL  $2 answered $got, expected $1" >&2; exit 1; }; echo "ok    $2 $got"; }
expect 200 "https://gtl.$DOMAIN/"
expect 200 "https://gtl.$DOMAIN/signin"
expect 401 "https://console.$DOMAIN/"
expect 404 "https://auth.$DOMAIN/"
curl -sS --max-time 30 "https://gtl.$DOMAIN/api/v1/academy" | grep -q '"googleSignIn":true' \
  || { echo "FAIL  Google sign-in is off at gtl.$DOMAIN" >&2; exit 1; }
echo "ok    Google sign-in is on"

echo "$TAG" > deploy/.deployed
docker images academy-app --format '{{.Tag}}' | grep -v -x -e current -e "$TAG" | tail -n +5 \
  | while read -r old; do docker rmi "academy-app:$old" >/dev/null 2>&1 || true; done
docker image prune -f >/dev/null

echo
echo "Deployed $TAG (previous: $PREVIOUS)."
if [ "$PREVIOUS" != none ]; then
  echo "To roll back, if no migration since $PREVIOUS needs the new code:"
  echo "  docker tag academy-app:$PREVIOUS academy-app:current && $C up -d --no-deps --wait api relay frontend"
fi
