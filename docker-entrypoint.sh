#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  node scripts/migrate.mjs
fi

exec node server.js
