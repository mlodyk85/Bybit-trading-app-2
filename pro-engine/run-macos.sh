#!/bin/zsh
set -e
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  echo "Missing pro-engine/.env"
  exit 1
fi
set -a
source .env
set +a
exec /usr/bin/env node server.js
