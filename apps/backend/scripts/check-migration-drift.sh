#!/usr/bin/env bash
# Fails if prisma/schema.prisma and the committed initial migration have
# drifted apart -- i.e. someone edited schema.prisma without regenerating/
# committing a migration for it. Runs entirely offline (no live database):
# `prisma migrate diff --from-empty --to-schema-datamodel` only reads the
# schema file. Comparison ignores blank lines and `--` comments so it isn't
# sensitive to header timestamps or formatting noise.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:=postgresql://user:pass@localhost:5432/db}"
: "${DIRECT_URL:=postgresql://user:pass@localhost:5432/db}"
export DATABASE_URL DIRECT_URL

GENERATED=$(mktemp)
trap 'rm -f "$GENERATED"' EXIT

npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "$GENERATED"

MIGRATION_FILE="prisma/migrations/20260101000000_init/migration.sql"

normalize() {
  grep -v '^--' "$1" | grep -v '^[[:space:]]*$'
}

if ! diff -u <(normalize "$GENERATED") <(normalize "$MIGRATION_FILE"); then
  echo ""
  echo "schema.prisma and $MIGRATION_FILE have drifted apart." >&2
  echo "Run 'npx prisma migrate dev' to generate a new migration and commit it." >&2
  exit 1
fi

echo "OK: $MIGRATION_FILE matches prisma/schema.prisma"
