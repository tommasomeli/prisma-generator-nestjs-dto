#!/usr/bin/env bash
# Regenerate the Prisma 8 test fixtures from the example project.
#
# Runs `prisma contract emit` in examples/prisma8-nestjs and copies the resulting
# contract.json / contract.prisma into test/fixtures/prisma8/blog/.
# Requires the example's dependencies (`cd examples/prisma8-nestjs && npm install`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE="$ROOT/examples/prisma8-nestjs"
FIXTURES="$ROOT/test/fixtures/prisma8/blog"

if [ ! -d "$EXAMPLE/node_modules" ]; then
    echo "error: $EXAMPLE/node_modules is missing; run 'npm install' there first" >&2
    exit 1
fi

export PRISMA_DISABLE_TELEMETRY=1
export CHECKPOINT_DISABLE=1

echo "==> prisma contract emit ($EXAMPLE)"
(cd "$EXAMPLE" && npm run --silent emit)

mkdir -p "$FIXTURES"
for f in contract.json contract.prisma; do
    cp "$EXAMPLE/src/prisma/$f" "$FIXTURES/$f"
    echo "==> updated test/fixtures/prisma8/blog/$f"
done

echo
echo "Fixtures refreshed. If snapshots changed, re-run: pnpm test -u (and review the diff)."
