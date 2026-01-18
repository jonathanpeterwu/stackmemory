#!/usr/bin/env bash
set -euo pipefail

echo "[railway-setup] Starting setup..."

# Ensure tsx is available
if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found; please run via npm scripts (npm run railway:setup)" >&2
  exit 1
fi

# Default SQLite path if DATABASE_URL not provided
if [[ -z "${DATABASE_URL:-}" ]]; then
  mkdir -p .stackmemory
  export DATABASE_URL="$(pwd)/.stackmemory/railway.db"
  echo "[railway-setup] DATABASE_URL not set; using ${DATABASE_URL}"
fi

echo "[railway-setup] Applying migrations to ${DATABASE_URL}"
npx tsx src/cli/commands/migrate.ts apply --to latest

echo "[railway-setup] Verifying schema version"
if npx tsx scripts/verify-railway-schema.ts; then
  echo "[railway-setup] Schema verified"
else
  code=$?
  if [[ "$code" == "2" ]]; then
    echo "[railway-setup] Schema below latest; retrying apply"
    npx tsx src/cli/commands/migrate.ts apply --to latest
  else
    echo "[railway-setup] Verification failed with code $code" >&2
    exit $code
  fi
fi

echo "[railway-setup] Done."

