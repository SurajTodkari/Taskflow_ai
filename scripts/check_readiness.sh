#!/usr/bin/env bash
# Readiness check: backend tests, migrations on temp sqlite, frontend typecheck+build, hardcode grep.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
step() { echo; echo "=== $1"; }
run() { if ! "$@"; then echo "FAILED: $*"; FAIL=1; fi; }

step "Backend pytest"
(cd "$ROOT/backend" && run python -m pytest -q)

step "Alembic upgrade on temp sqlite"
TMPDB="$(mktemp -d)/check.db"
(cd "$ROOT/backend" && DATABASE_URL="sqlite:///$TMPDB" SECRET_KEY=check run alembic upgrade head)

step "Frontend tsc + build"
(cd "$ROOT/frontend" && { [ -d node_modules ] || run npm ci; } && run npx tsc --noEmit && run npm run build)

step "Grep for hardcoded localhost"
HITS=$(grep -rnE "localhost|127\.0\.0\.1" "$ROOT/backend/app" "$ROOT/frontend/src" 2>/dev/null | grep -v "VITE_API_URL" | grep -vE "import\.meta\.env.*localhost|DEV" || true)
if [ -n "$HITS" ]; then echo "$HITS"; echo "REVIEW: localhost references above (allowed only as dev-only fallback)"; FAIL=1; fi

step "Grep for hardcoded secrets"
SEC=$(grep -rnEi "(sk-ant-[A-Za-z0-9_-]{10,}|BEGIN (RSA |EC )?PRIVATE KEY|(secret_key|vapid_private_key|api_key)[\"' ]*[:=][ ]*[\"'][A-Za-z0-9_+/=-]{16,})" "$ROOT/backend/app" "$ROOT/frontend/src" 2>/dev/null || true)
if [ -n "$SEC" ]; then echo "$SEC"; FAIL=1; fi

echo
if [ $FAIL -eq 0 ]; then echo "READY: all checks passed"; else echo "NOT READY: see failures above"; fi
exit $FAIL
