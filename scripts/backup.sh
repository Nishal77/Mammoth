#!/usr/bin/env bash
# =============================================================================
# MAMMOTH backup script
# Backs up: PostgreSQL (pg_dump), Qdrant (collection snapshots), MinIO (mc),
# and Redis (RDB dump). Writes a manifest.json for restore validation.
#
# Usage: ./scripts/backup.sh [OPTIONS]
#   --output-dir DIR   Root directory for backups (default: ./backups)
#   --services LIST    Comma-separated: postgres,qdrant,minio,redis (default: all)
#   --env-file PATH    Env file to source credentials (default: .env.local)
#   --compress         Tar+gzip the final backup directory
#   --dry-run          Print commands without executing
#   --help             Show this message
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
log_info() { echo -e "${BLUE}[backup]${NC} $*"; }
log_ok()   { echo -e "${GREEN}[backup]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[backup]${NC} WARNING: $*"; }
log_err()  { echo -e "${RED}[backup]${NC} ERROR: $*" >&2; }

# ---- defaults -----------------------------------------------------------------
OUTPUT_DIR="${REPO_ROOT}/backups"
SERVICES="postgres,qdrant,minio,redis"
ENV_FILE="${REPO_ROOT}/.env.local"
COMPRESS=false
DRY_RUN=false

# ---- helpers ------------------------------------------------------------------
show_help() {
  sed -n '3,14p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
  exit 0
}

should_backup() { [[ ",${SERVICES}," == *",$1,"* ]]; }

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

file_size_bytes() {
  if [[ -f "$1" ]]; then
    du -sb "$1" 2>/dev/null | awk '{print $1}' || stat -f%z "$1" 2>/dev/null || echo 0
  elif [[ -d "$1" ]]; then
    du -sb "$1" 2>/dev/null | awk '{print $1}' || echo 0
  else
    echo 0
  fi
}

# ---- parse args ---------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --services)   SERVICES="$2";   shift 2 ;;
    --env-file)   ENV_FILE="$2";   shift 2 ;;
    --compress)   COMPRESS=true;   shift ;;
    --dry-run)    DRY_RUN=true;    shift ;;
    --help|-h)    show_help ;;
    *) die "Unknown flag: $1. Run with --help for usage." ;;
  esac
done

# ---- service backups ----------------------------------------------------------
backup_postgres() {
  local dest="$1"
  require_container "${POSTGRES_CONTAINER}"
  log_info "Backing up PostgreSQL..."

  if [[ "${DRY_RUN}" == "true" ]]; then
    log_info "[dry-run] docker exec ${POSTGRES_CONTAINER} pg_dump -U ${POSTGRES_USER} -Fc ${POSTGRES_DB} > ${dest}/postgres.dump"
    return 0
  fi

  # pg_dump inside the container avoids local pg_dump version mismatch
  docker exec "${POSTGRES_CONTAINER}" \
    pg_dump -U "${POSTGRES_USER}" -Fc "${POSTGRES_DB}" \
    > "${dest}/postgres.dump"

  log_ok "PostgreSQL done. Size: $(file_size_bytes "${dest}/postgres.dump") bytes"
}

backup_qdrant() {
  local dest="$1"
  require_container "${QDRANT_CONTAINER}"
  log_info "Backing up Qdrant collections..."

  local collections
  collections=$(curl -sf "${QDRANT_URL}/collections" | jq -r '.result.collections[].name' 2>/dev/null || true)

  if [[ -z "${collections}" ]]; then
    log_warn "No Qdrant collections found — writing empty marker"
    [[ "${DRY_RUN}" != "true" ]] && echo "[]" > "${dest}/qdrant-collections.json"
    return 0
  fi

  mkdir -p "${dest}/qdrant"
  echo "${collections}" > "${dest}/qdrant-collections.json"

  while IFS= read -r coll; do
    backup_qdrant_collection "${dest}" "${coll}"
  done <<< "${collections}"

  log_ok "Qdrant done. Collections: $(echo "${collections}" | wc -l | tr -d ' ')"
}

backup_qdrant_collection() {
  local dest="$1" coll="$2"
  log_info "  Snapshotting collection: ${coll}"

  if [[ "${DRY_RUN}" == "true" ]]; then
    log_info "  [dry-run] POST ${QDRANT_URL}/collections/${coll}/snapshots"
    log_info "  [dry-run] GET  ${QDRANT_URL}/collections/${coll}/snapshots/{name} -> ${dest}/qdrant/${coll}.snapshot"
    return 0
  fi

  local snap_name
  snap_name=$(curl -sf -X POST "${QDRANT_URL}/collections/${coll}/snapshots" \
    | jq -r '.result.name')

  [[ -z "${snap_name}" ]] && die "Qdrant snapshot creation failed for collection '${coll}'"

  curl -sf -o "${dest}/qdrant/${coll}.snapshot" \
    "${QDRANT_URL}/collections/${coll}/snapshots/${snap_name}"

  # Remove snapshot from server to free Qdrant storage
  curl -sf -X DELETE "${QDRANT_URL}/collections/${coll}/snapshots/${snap_name}" > /dev/null
}

backup_minio() {
  local dest="$1"
  require_container "${MINIO_CONTAINER}"
  log_info "Backing up MinIO bucket '${MINIO_BUCKET}'..."

  # Detect host reachable from inside a Docker container
  local minio_host
  minio_host=$(docker_host_address)
  mkdir -p "${dest}/minio"

  if [[ "${DRY_RUN}" == "true" ]]; then
    log_info "[dry-run] minio/mc mirror http://${minio_host}:${MINIO_PORT}/${MINIO_BUCKET} -> ${dest}/minio/"
    return 0
  fi

  docker run --rm \
    -v "${dest}/minio:/backup" \
    --entrypoint="" \
    minio/mc sh -c \
    "mc alias set myminio http://${minio_host}:${MINIO_PORT} ${MINIO_USER} ${MINIO_PASS} --quiet && \
     mc mirror myminio/${MINIO_BUCKET} /backup/ --overwrite --quiet" 2>&1 \
    || { log_warn "MinIO backup failed — minio/mc pull may be needed (docker pull minio/mc)"; return 1; }

  log_ok "MinIO done. Size: $(file_size_bytes "${dest}/minio") bytes"
}

backup_redis() {
  local dest="$1"
  require_container "${REDIS_CONTAINER}"
  log_info "Backing up Redis RDB..."

  if [[ "${DRY_RUN}" == "true" ]]; then
    log_info "[dry-run] redis-cli SAVE && docker cp ${REDIS_CONTAINER}:/data/dump.rdb ${dest}/redis.rdb"
    return 0
  fi

  # SAVE is synchronous — blocks until dump.rdb is written
  docker exec "${REDIS_CONTAINER}" redis-cli SAVE > /dev/null
  docker cp "${REDIS_CONTAINER}:/data/dump.rdb" "${dest}/redis.rdb"

  log_ok "Redis done. Size: $(file_size_bytes "${dest}/redis.rdb") bytes"
}

docker_host_address() {
  case "$(uname -s)" in
    Darwin) echo "host.docker.internal" ;;
    Linux)  docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || echo "172.17.0.1" ;;
    *)      echo "host.docker.internal" ;;
  esac
}

write_manifest() {
  local dest="$1"
  local ts="$2"
  [[ "${DRY_RUN}" == "true" ]] && { log_info "[dry-run] write manifest.json"; return 0; }

  jq -n \
    --arg version "1.0.0" \
    --arg timestamp "${ts}" \
    --arg hostname "$(hostname)" \
    --arg services "${SERVICES}" \
    --argjson pg_size "$(file_size_bytes "${dest}/postgres.dump")" \
    --argjson qdrant_size "$(file_size_bytes "${dest}/qdrant")" \
    --argjson minio_size "$(file_size_bytes "${dest}/minio")" \
    --argjson redis_size "$(file_size_bytes "${dest}/redis.rdb")" \
    '{
      version:   $version,
      timestamp: $timestamp,
      hostname:  $hostname,
      services:  ($services | split(",")),
      sizes: {
        postgres: $pg_size,
        qdrant:   $qdrant_size,
        minio:    $minio_size,
        redis:    $redis_size
      }
    }' > "${dest}/manifest.json"

  log_ok "manifest.json written"
}

# ---- main ---------------------------------------------------------------------
main() {
  local ts
  ts="$(date -u '+%Y%m%d_%H%M%S')"
  local backup_dir="${OUTPUT_DIR}/${ts}"

  log_info "MAMMOTH backup — $(date -u)"
  log_info "Services:  ${SERVICES}"
  log_info "Dest:      ${backup_dir}"
  [[ "${DRY_RUN}" == "true" ]] && log_warn "DRY-RUN mode — no files will be written"

  # Load overrides from env file if present (for custom container credentials)
  [[ -f "${ENV_FILE}" ]] && { set -a; source "${ENV_FILE}"; set +a; } || true

  [[ "${DRY_RUN}" != "true" ]] && mkdir -p "${backup_dir}"

  local failed=()

  should_backup "postgres" && { backup_postgres "${backup_dir}" || failed+=("postgres"); }
  should_backup "qdrant"   && { backup_qdrant   "${backup_dir}" || failed+=("qdrant");   }
  should_backup "minio"    && { backup_minio    "${backup_dir}" || failed+=("minio");    }
  should_backup "redis"    && { backup_redis    "${backup_dir}" || failed+=("redis");    }

  write_manifest "${backup_dir}" "${ts}"

  if [[ "${COMPRESS}" == "true" && "${DRY_RUN}" != "true" ]]; then
    log_info "Compressing..."
    tar -czf "${backup_dir}.tar.gz" -C "${OUTPUT_DIR}" "${ts}"
    rm -rf "${backup_dir}"
    log_ok "Archive: ${backup_dir}.tar.gz"
  fi

  if [[ ${#failed[@]} -gt 0 ]]; then
    log_warn "Completed with failures: ${failed[*]}"
    exit 1
  fi

  log_ok "Backup complete: ${backup_dir}"
}

main "$@"
