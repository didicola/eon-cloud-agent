#!/usr/bin/env bash
# deploy-neural-web.sh — EON Neural Web edge-mirror deploy (run on the twin / any node with a CF token)
# Usage: CLOUDFLARE_API_TOKEN=... bash deploy-neural-web.sh
set -euo pipefail

echo "== EON Neural Web deploy =="

# 1. copy the worker source into the deploy project
cp ../shadow-mesh.js src/index.js

# 2. create the KV namespace if idle is not set
if [ "${NEURAL_KV_ID:-X}" = "X" ]; then
  echo ">>> creating NEURAL_KV namespace..."
  NEURAL_KV_ID=$(npx wrangler kv namespace create NEURAL_KV 2>&1 | grep -oE '"[0-9a-f]{32}"' | tr -d '"')
  echo "    NEURAL_KV_ID=$NEURAL_KV_ID"
fi
sed -i "s/REPLACE_WITH_NEURAL_KV_ID/$NEURAL_KV_ID/" wrangler.toml

# 3. deploy
echo ">>> deploying..."
npx wrangler deploy

echo ">>> done. live URL:"
echo "    https://eon-neural-web.<subdomain>.workers.dev"
echo "    health: curl -s https://eon-neural-web.<subdomain>.workers.dev/api/health"
echo "    nodes:  curl -s https://eon-neural-web.<subdomain>.workers.dev/api/nodes"