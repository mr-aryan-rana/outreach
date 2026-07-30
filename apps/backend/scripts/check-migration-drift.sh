#!/usr/bin/env bash
# Fails if prisma/schema.prisma and the committed migration history have
# drifted apart -- i.e. someone edited schema.prisma without regenerating/
# committing a migration for it.
#
# Robust mode (SHADOW_DATABASE_URL set, e.g. CI's ephemeral Postgres service
# container -- see .github/workflows/ci.yml): uses `prisma migrate diff
# --from-migrations --to-schema-datamodel`, which replays the actual
# migration history against a throwaway shadow database and diffs the
# *resulting* state against schema.prisma. This is the only approach that's
# correct once there's more than one migration -- comparing raw generated
# SQL text (the old approach here) breaks the moment a later migration is an
# incremental ALTER TABLE while a from-empty diff inlines everything into one
# CREATE TABLE: same resulting schema, different SQL text, false positive.
#
# Fallback mode (no SHADOW_DATABASE_URL, e.g. a contributor's machine with no
# local Postgres): falls back to the old from-empty-vs-concatenated-files
# text comparison. Best-effort only -- accurate for a single-migration
# history, prone to the false positive described above once there are
# several. Prefer running with a real SHADOW_DATABASE_URL when possible.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:=postgresql://user:pass@localhost:5432/db}"
: "${DIRECT_URL:=postgresql://user:pass@localhost:5432/db}"
export DATABASE_URL DIRECT_URL

if [ -n "${SHADOW_DATABASE_URL:-}" ]; then
  DIFF_OUTPUT=$(npx prisma migrate diff \
    --from-migrations prisma/migrations \
    --to-schema-datamodel prisma/schema.prisma \
    --shadow-database-url "$SHADOW_DATABASE_URL" \
    --script)

  # An empty diff (no DDL statements, only the boilerplate header comment)
  # means schema.prisma already matches what the migration history produces.
  MEANINGFUL_LINES=$(echo "$DIFF_OUTPUT" | grep -v '^--' | grep -v '^[[:space:]]*$' || true)
  if [ -n "$MEANINGFUL_LINES" ]; then
    echo "$DIFF_OUTPUT"
    echo ""
    echo "schema.prisma and the migration history (prisma/migrations/) have drifted apart." >&2
    echo "Run 'npx prisma migrate dev' to generate a new migration and commit it." >&2
    exit 1
  fi
  echo "OK: prisma/migrations/ matches prisma/schema.prisma (verified via shadow database replay)"
  exit 0
fi

echo "WARNING: SHADOW_DATABASE_URL not set -- falling back to best-effort text comparison" >&2
echo "(accurate for a single-migration history only; see script comments)" >&2

GENERATED=$(mktemp)
ALL_MIGRATIONS=$(mktemp)
trap 'rm -f "$GENERATED" "$ALL_MIGRATIONS"' EXIT

npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "$GENERATED"

for dir in prisma/migrations/*/; do
  [ -f "${dir}migration.sql" ] && cat "${dir}migration.sql" >> "$ALL_MIGRATIONS"
done

normalize() {
  grep -v '^--' "$1" | grep -v '^[[:space:]]*$'
}

if ! diff -u <(normalize "$GENERATED") <(normalize "$ALL_MIGRATIONS"); then
  echo ""
  echo "schema.prisma and the migration history (prisma/migrations/) may have drifted apart" >&2
  echo "(or this is a false positive from the text-comparison fallback -- see script comments)." >&2
  echo "Run 'npx prisma migrate dev' to generate a new migration and commit it," >&2
  echo "or re-run with SHADOW_DATABASE_URL set for an accurate check." >&2
  exit 1
fi

echo "OK (best-effort): prisma/migrations/ matches prisma/schema.prisma"
