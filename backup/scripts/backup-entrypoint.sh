#!/usr/bin/env bash
set -Eeuo pipefail

require_env() {
    local name="$1"
    if [[ -z "${!name:-}" ]]; then
        echo "Missing required environment variable: ${name}" >&2
        exit 1
    fi
}

require_env RESTIC_REPOSITORY
require_env RESTIC_PASSWORD
require_env AWS_ACCESS_KEY_ID
require_env AWS_SECRET_ACCESS_KEY
require_env POSTGRES_PASSWORD
require_env VERIFICATION_DB_PASSWORD
require_env SUPPLIER_PROXY_DB_PASSWORD
require_env STUDIES_SYNC_DB_PASSWORD

export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-/cache/restic}"
mkdir -p "${RESTIC_CACHE_DIR}"

if ! restic snapshots --no-lock >/dev/null 2>&1; then
    echo "Restic repository is not initialized or not reachable. Attempting initialization."
    restic init
fi

run_backup() {
    if ! backup-once.sh; then
        echo "Backup run failed. The container will keep running and retry on the next interval." >&2
        return 1
    fi
}

if [[ "${BACKUP_RUN_ON_START:-true}" == "true" ]]; then
    run_backup || true
fi

interval="${BACKUP_INTERVAL_SECONDS:-21600}"
if ! [[ "${interval}" =~ ^[0-9]+$ ]] || [[ "${interval}" -lt 60 ]]; then
    echo "BACKUP_INTERVAL_SECONDS must be an integer >= 60." >&2
    exit 1
fi

echo "Backup scheduler started. Interval: ${interval}s."

while true; do
    sleep "${interval}"
    run_backup || true
done
