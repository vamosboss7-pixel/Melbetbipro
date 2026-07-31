#!/bin/sh
set -e

echo "[entrypoint] Pushing DB schema..."
pnpm --filter @workspace/db run push-force 2>&1 || echo "[entrypoint] DB schema push failed — skipping"

echo "[entrypoint] Starting server..."
exec node artifacts/api-server/dist/index.mjs
