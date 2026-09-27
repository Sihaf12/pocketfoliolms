#!/bin/sh
# Proves the demo seed loads, loads again without duplicating anything,
# holds the curriculum the demo needs, and carries brand tokens the
# server will accept. Uses a throwaway database; expects a fresh build.
set -eu

db="academy_demo_test_$$"
createdb "$db"
trap 'dropdb --if-exists "$db"' EXIT
url="postgres:///$db"

PGOPTIONS="-c client_min_messages=warning" OWNER_DATABASE_URL="$url" npm run --silent migrate >/dev/null
for pass in 1 2; do
  PGOPTIONS="-c client_min_messages=warning" psql "$url" -v ON_ERROR_STOP=1 -q -f db/seed/demo.sql
done

out="$(mktemp)"
trap 'dropdb --if-exists "$db"; rm -f "$out"' EXIT
if ! psql "$url" -v ON_ERROR_STOP=1 -q -f db/tests/demo_seed_checks.sql >"$out" 2>&1; then
  sed -nE 's/^.*(NOTICE|ERROR):  //p' "$out"
  exit 1
fi
sed -n 's/^.*NOTICE:  //p' "$out"

# Brand tokens go through the server's own sanitiser and contrast check,
# not a copy of them.
psql "$url" -tA -F '|' -c "SELECT slug, brand::text FROM app.tenants ORDER BY slug" | node --input-type=module -e "
  import { sanitiseBrand } from './dist/packages/shared/brand.js';
  import { checkPalette } from './dist/packages/shared/contrast.js';
  import { createInterface } from 'node:readline';
  let ok = 0;
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line) continue;
    const at = line.indexOf('|');
    const slug = line.slice(0, at);
    const raw = JSON.parse(line.slice(at + 1));
    const clean = sanitiseBrand(raw);
    if (clean.refused.length > 0 || Object.keys(clean.tokens).length !== 10) {
      console.error('FAIL  ' + slug + ' brand refused: ' + clean.refused.join(', '));
      process.exit(1);
    }
    const contrast = checkPalette(clean.tokens);
    if (!contrast.ok) {
      console.error('FAIL  ' + slug + ' contrast: ' + contrast.failures.map((f) => f.text + ' on ' + f.on + ' ' + f.ratio).join(', '));
      process.exit(1);
    }
    ok += 1;
  }
  if (ok !== 3) { console.error('FAIL  expected 3 brands, saw ' + ok); process.exit(1); }
  console.log('PASS  all three brands keep all ten tokens and pass every contrast pair');
"

# Staging passes its own parent domain: the same academies move to it in
# place, keyed by slug, and nothing stays behind on academy.test.
PGOPTIONS="-c client_min_messages=warning" psql "$url" -v ON_ERROR_STOP=1 -q -v demo_domain=academy-staging.example.com -f db/seed/demo.sql
moved="$(psql "$url" -tA -c "SELECT string_agg(primary_domain, ' ' ORDER BY primary_domain) FROM app.tenants")"
if [ "$moved" != "gtl.academy-staging.example.com meridian.academy-staging.example.com pocketfolio.academy-staging.example.com" ]; then
  echo "FAIL  seeding with demo_domain gave: $moved"
  exit 1
fi
echo "PASS  a staging domain moves the three academies in place"

