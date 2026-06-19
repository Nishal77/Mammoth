#!/usr/bin/env bash
# =============================================================================
# MAMMOTH restore script
# Restores from a backup produced by backup.sh.
# Reads manifest.json to validate the backup before touching any data.
#
# Usage: ./scripts/restore.sh BACKUP_PATH [OPTIONS]
#   BACKUP_PATH        Path to a backup directory (or .tar.gz archive)
#   --services LIST    Comma-separated: postgres,qdrant,minio,redis (default: from manifest)
#   --env-file PATH    Env file to source credentials (default: .env.local)
#   --force            Skip confirmation prompt
#   --dry-run          Print commands without executing
#   --help             Show this message
#
# WARNING: Restore overwrites all existing data in the target services.
# =============================================================================
set -euo pipefail

# ---- constants ----------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

POSTGRES_CONTAINER="mammoth_postgres"
QDRANT_CONTAINER="mammoth_qdrant"
MINIO_CONTAINER="mammoth_minio"
REDIS_CONTAINER="mammoth_redis"

POSTGRES_USER="mammoth"
POSTGRES_DB="mammoth"
QDRANT_URL="http://localhost:6333"
MINIO_PORT=9000
MINIO_USER="minioadmin"
MINIO_PASS="minioadmin_dev"
MINIO_BUCKET="mammoth"

# ---- colors & logging ---------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info() { echo -e "${BLUE}[restore]${NC} $*"; }
log_ok()   { echo -e "${GREEN}[restore]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[restore]${NC} WARNING: $*"; }
log_err()  { echo -e "${RED}[restore]${NC} ERROR: $*" >&2; }

# ---- defaults -----------------------------------------------------------------
BACKUP_PATH=""
SERVICES=""
ENV_FILE="${REPO_ROOT}/.env.local"
FORCE=false
DRY_RUN=false

# ---- helpers ------------------------------------------------------------------
show_help() {
  sed -n '3,15p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
  exit 0
}

should_restore() { [[ ",${SERVICES}," == *",$1,"* ]]; }

run() {
  if [[ "${DRY_RUN}" == "true" ]]; then
    log_info "[dry-run] $*"
  else
    "$@"
  fi
}

die() { log_err "$*"; exit 1; }

require_container() {
  [[ "${DRY_RUN}" == "true" ]] && return 0
  docker ps --filter "name=^$1$" --filter "status=running" --format "{{.Names}}" \
    | grep -q "^$1$" || die "Container '$1' is not running. Start services first: docker compose up -d"
}

docker_host_address() {
  case "$(uname -s)" in
    Darwin) echo "host.docker.internal" ;;
    Linux)  docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || echo "172.17.0.1" ;;
    *)      echo "host.docker.internal" ;;
  esac
}

# ---- parse args ---------------------------------------------------------------
[[ $# -eq 0 ]] && { show_help; }

# First positional arg is the backup path
if [[ "$1" != --* && "$1" != -h && "$1" != --help ]]; then
  BACKUP_PATH="$1"; shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --services) SERVICES="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --force)    FORCE=true;    shift ;;
    --dry-run)  DRY_RUN=true;  shift ;;
    --help|-h)  show_help ;;
    *) die "Unknown flag: $1. Run with --help for usage." ;;
  esac
done

# ---- validate backup ----------------------------------------------------------
validate_backup() {
  [[ -n "${BACKUP_PATH}" ]] || die "BACKUP_PATH is required as the first argument"

  # Decompress archive if needed
  if [[ "${BACKUP_PATH}" == *.tar.gz ]]; then
    log_info "Decompressing archive..."
    local tmp_dir
    tmp_dir="$(mktemp -d)"
    [[ "${DRY_RUN}" != "true" ]] && tar -xzf "${BACKUP_PATH}" -C "${tmp_dir}"
    BACKUP_PATH="${tmp_dir}/$(tar -tzf "${BACKUP_PATH}" | head -1 | cut -d/ -f1)"
    log_info "Extracted to: ${BACKUP_PATH}"
  fi

  [[ -d "${BACKUP_PATH}" ]] || die "Backup directory not found: ${BACKUP_PATH}"

  local manifest="${BACKUP_PATH}/manifest.json"
  [[ -f "${manifest}" ]] || die "manifest.json not found in ${BACKUP_PATH} — not a valid backup"

  local manifest_version
  manifest_version=$(jq -r '.version' "${manifest}")
  [[ "${manifest_version}" == "1.0.0" ]] || die "Unsupported manifest version: ${manifest_version}"

  local backup_ts
  backup_ts=$(jq -r '.timestamp' "${manifest}")
  log_info "Backup timestamp: ${backup_ts}"
  log_info "Backup hostname:  $(jq -r '.hostname' "${manifest}")"

  # Default services to whatever was backed up
  if [[ -z "${SERVICES}" ]]; then
    SERVICES=$(jq -r '.services | join(",")' "${manifest}")
  fi

  log_info "Restoring services: ${SERVICES}"
}

# ---- confirmation prompt ------------------------------------------------------
confirm_restore() {
  if [[ "${FORCE}" == "true" || "${DRY_RUN}" == "true" ]]; then
    return 0
  fi

  echo ""
  echo -e "${RED}WARNING: This will overwrite all existing data in: ${SERVICES}${NC}"
  echo -e "         Backup source: ${BACKUP_PATH}"
  echo ""
  read -r -p "Type 'yes' to continue: " answer
  [[ "${answer}" == "yes" ]] || { log_info "Aborted."; exit 0; }
}

# ---- service restores ---------------------------------------------------------
restore_postgres() {
  local src="$1"
  local dump_file="${src}/postgres.dump"
  [[ -f "${dump_file}" ]] || die "postgres.dump not found in backup"

  require_container "${POSTGRES_CONTAINER}"
  log_info "Restoring PostgreSQL..."

  if [[ "${DRY_RUN}" == "true" ]]; then
    log_info "[dry-run] drop + recreate DB '${POSTGRES_DB}' then pg_restore < ${dump_file}"
    return 0
  fi

  # Drop connections, drop DB, recreate, then restore
  docker exec "${POSTGRES_CONTAINER}" psql -U "${POSTGRES_USER}" -d postgres -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${POSTGRES_DB}' AND pid <> pg_backend_pid();" > /dev/null

  docker exec "${POSTGRES_CONTAINER}" psql -U "${POSTGRES_USER}" -d postgres -c \
    "DROP DATABASE IF EXISTS ${POSTGRES_DB};" > /dev/null

  docker exec "${POSTGRES_CONTAINER}" psql -U "${POSTGRES_USER}" -d postgres -c \
    "CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER};" > /dev/null

  docker exec -i "${POSTGRES_CONTAINER}" \
    pg_restore -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner --role="${POSTGRES_USER}" \
    < "${dump_file}"

  log_ok "PostgreSQL restored"
}

restore_qdrant() {
  local src="$1"
  local collections_file="${src}/qdrant-collections.json"
  [[ -f "${collections_file}" ]] || die "qdrant-collections.json not found in backup"

  require_container "${QDRANT_CONTAINER}"
  log_info "Restoring Qdrant collections..."

  local collections
  collections=$(cat "${collections_file}")

  if [[ "${collections}" == "[]" || -z "${collections}" ]]; then
    log_info "No Qdrant collections in backup — nothing to restore"
    return 0
  fi

  while IFS= read -r coll; do
    restore_qdrant_collection "${src}" "${coll}"
  done <<< "$(echo "${collections}" | tr -d '"' | tr ',' '\n' | tr -d '[]' | grep -v '^$')"

  log_ok "Qdrant restored"
}

restore_qdrant_collection() {
  local src="$1" coll="$2"
  local snapshot_file="${src}/qdrant/${coll}.snapshot"
  [[ -f "${snapshot_file}" ]] || { log_warn "  Snapshot not found for '${coll}' — skipping"; return 0; }

  log_info "  Restoring collection: ${coll}"

  if [[ "${DRY_RUN}" == "true" ]]; then
    log_info "  [dry-run] DELETE /collections/${coll} then PUT /collections/${coll}/snapshots/upload"
    return 0
  fi

  # Delete existing collection to ensure clean restore
  curl -sf -X DELETE "${QDRANT_URL}/collections/${coll}" > /dev/null || true

  # Upload snapshot — Qdrant recreates the collection from it
  curl -sf -X PUT "${QDRANT_URL}/collections/${coll}/snapshots/upload?priority=snapshot&wait=true" \
    -H "Content-Type: multipart/form-data" \
    -F "snapshot=@${snapshot_file}" > /dev/null \
    || die "Qdrant restore failed for collection '${coll}'"
}

restore_minio() {
  local src="$1"
  local minio_src="${src}/minio"
  [[ -d "${minio_src}" ]] || die "minio/ directory not found in backup"

  require_container "${MINIO_CONTAINER}"
  log_info "Restoring MinIO bucket '${MINIO_BUCKET}'..."

  local minio_host
  minio_host=$(docker_host_address)

  if [[ "${DRY_RUN}" == "true" ]]; then
    log_info "[dry-run] minio/mc mirror ${minio_src}/ -> myminio/${MINIO_BUCKET}/"
    return 0
  fi

  docker run --rm \
    -v "${minio_src}:/backup:ro" \
    --entrypoint="" \
    minio/mc sh -c \
    "mc alias set myminio http://${minio_host}:${MINIO_PORT} ${MINIO_USER} ${MINIO_PASS} --quiet && \
     mc mb --ignore-existing myminio/${MINIO_BUCKET} && \
     mc mirror /backup/ myminio/${MINIO_BUCKET}/ --overwrite --quiet" 2>&1 \
    || die "MinIO restore failed"

  log_ok "MinIO restored"
}

restore_redis() {
  local src="$1"
  local rdb_file="${src}/redis.rdb"
  [[ -f "${rdb_file}" ]] || die "redis.rdb not found in backup"

  require_container "${REDIS_CONTAINER}"
  log_info "Restoring Redis RDB..."

  if [[ "${DRY_RUN}" == "true" ]]; then
    log_info "[dry-run] docker cp ${rdb_file} -> ${REDIS_CONTAINER}:/data/dump.rdb + restart"
    return 0
  fi

  # Flush current data, copy RDB, then restart Redis to load it
  docker exec "${REDIS_CONTAINER}" redis-cli FLUSHALL > /dev/null
  docker cp "${rdb_file}" "${REDIS_CONTAINER}:/data/dump.rdb"
  docker restart "${REDIS_CONTAINER}" > /dev/null

  # Wait for Redis to be ready after restart
  local retries=15
  while ! docker exec "${REDIS_CONTAINER}" redis-cli PING 2>/dev/null | grep -q "PONG"; do
    [[ $((retries--)) -le 0 ]] && die "Redis did not come back up after restore"
    sleep 1
  done

  log_ok "Redis restored"
}

# ---- main ---------------------------------------------------------------------
main() {
  log_info "MAMMOTH restore — $(date -u)"
  [[ "${DRY_RUN}" == "true" ]] && log_warn "DRY-RUN mode — no data will be modified"

  [[ -f "${ENV_FILE}" ]] && { set -a; source "${ENV_FILE}"; set +a; } || true

  validate_backup
  confirm_restore

  local failed=()

  should_restore "postgres" && { restore_postgres "${BACKUP_PATH}" || failed+=("postgres"); }
  should_restore "qdrant"   && { restore_qdrant   "${BACKUP_PATH}" || failed+=("qdrant");   }
  should_restore "minio"    && { restore_minio    "${BACKUP_PATH}" || failed+=("minio");    }
  should_restore "redis"    && { restore_redis    "${BACKUP_PATH}" || failed+=("redis");    }

  if [[ ${#failed[@]} -gt 0 ]]; then
    log_warn "Completed with failures: ${failed[*]}"
    exit 1
  fi

  log_ok "Restore complete from: ${BACKUP_PATH}"
}

main "$@"
