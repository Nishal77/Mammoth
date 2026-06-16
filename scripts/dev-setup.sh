#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "==> Checking prerequisites"
command -v docker   >/dev/null 2>&1 || { echo "docker not found. Install Docker Desktop."; exit 1; }
command -v pnpm     >/dev/null 2>&1 || { echo "pnpm not found. Run: npm i -g pnpm"; exit 1; }
command -v node     >/dev/null 2>&1 || { echo "node not found. Install Node 20+."; exit 1; }

NODE_MAJOR=$(node -e "process.stdout.write(process.version.split('.')[0].slice(1))")
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  echo "Node 20+ required. Current: $(node -v)"
  exit 1
fi

echo "==> Installing dependencies"
cd "${ROOT_DIR}"
pnpm install

echo "==> Copying .env.example to .env (if not present)"
if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  cp "${ROOT_DIR}/.env.example" "${ROOT_DIR}/.env"
  echo "    Created .env — fill in ANTHROPIC_API_KEY and BETTER_AUTH_SECRET before running API"
fi

echo "==> Starting Docker services"
docker compose \
  -f "${ROOT_DIR}/infrastructure/docker/docker-compose.dev.yml" \
  up -d --wait postgres redis qdrant minio

echo "==> Waiting for Postgres to accept connections"
until docker exec mammoth_postgres pg_isready -U mammoth -d mammoth -q; do
  sleep 1
done

echo "==> Running DB migrations"
cd "${ROOT_DIR}"
pnpm --filter @mammoth/db db:migrate

echo "==> Applying RLS policies"
docker exec -i mammoth_postgres psql -U mammoth -d mammoth \
  < "${ROOT_DIR}/packages/db/src/migrations/0001_rls_policies.sql"

echo "==> Creating MinIO bucket"
docker exec mammoth_minio sh -c \
  "mc alias set local http://localhost:9000 minioadmin minioadmin_dev && \
   mc mb --ignore-existing local/mammoth"

echo ""
echo "Dev environment ready."
echo "  Postgres : postgresql://mammoth:mammoth_dev@localhost:5432/mammoth"
echo "  Redis    : redis://localhost:6379"
echo "  Qdrant   : http://localhost:6333"
echo "  MinIO    : http://localhost:9000  (console: http://localhost:9001)"
echo ""
echo "Start the API:"
echo "  pnpm --filter @mammoth/api dev"
