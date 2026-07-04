#!/usr/bin/env bash
set -Eeuo pipefail

# Backs up all four PostgreSQL databases and the Medplum binary storage
# volume into an encrypted restic repository (Hetzner Object Storage / S3).
#
# Each database uses a CONSTANT stdin-filename (no timestamp) so that restic
# groups its snapshots by path and the retention policy in `restic forget`
# works as intended. History is provided by restic snapshots, not filenames.

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

snapshot_host="${BACKUP_RESTIC_HOSTNAME:-hca-care}"
binary_dir="${BACKUP_BINARY_DIR:-/data/medplum-binary}"

medplum_user="${POSTGRES_USER:-medplum}"
medplum_db="${POSTGRES_DB:-medplum}"

# name | database URL
databases=(
    "medplum|postgres://${medplum_user}:${POSTGRES_PASSWORD}@postgres:5432/${medplum_db}"
    "verification|postgres://verification:${VERIFICATION_DB_PASSWORD}@verification-db:5432/verification"
    "supplier_proxy|postgres://supplier:${SUPPLIER_PROXY_DB_PASSWORD}@supplier-proxy-db:5432/supplier_proxy"
    "studies_sync|postgres://studies:${STUDIES_SYNC_DB_PASSWORD}@studies-sync-db:5432/studies_sync"
)

for entry in "${databases[@]}"; do
    name="${entry%%|*}"
    url="${entry#*|}"
    stdin_filename="postgres/${name}/${name}.dump"

    echo "Starting PostgreSQL logical backup: ${stdin_filename}"

    pg_dump \
        --format=custom \
        --compress=0 \
        --no-owner \
        --no-acl \
        --dbname="${url}" \
        | restic backup \
            --host "${snapshot_host}" \
            --tag postgres \
            --tag hca-care \
            --tag "${name}" \
            --stdin \
            --stdin-filename "${stdin_filename}"
done

if [[ -d "${binary_dir}" ]]; then
    echo "Starting Medplum binary storage backup: ${binary_dir}"
    restic backup \
        --host "${snapshot_host}" \
        --tag binary \
        --tag hca-care \
        "${binary_dir}"
else
    echo "Binary storage directory ${binary_dir} not found — skipping." >&2
fi

echo "Backups completed. Applying retention policy."

restic forget \
    --host "${snapshot_host}" \
    --keep-daily "${BACKUP_RETENTION_DAILY:-14}" \
    --keep-weekly "${BACKUP_RETENTION_WEEKLY:-8}" \
    --keep-monthly "${BACKUP_RETENTION_MONTHLY:-3}" \
    --prune

if [[ "${BACKUP_RUN_CHECK_AFTER_BACKUP:-false}" == "true" ]]; then
    echo "Running restic repository check."
    restic check
fi

if [[ -n "${BACKUP_PING_URL:-}" ]]; then
    echo "Pinging backup monitor."
    curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_PING_URL}" \
        || echo "Backup monitor ping failed (backup itself succeeded)." >&2
fi

echo "Backup maintenance completed."
