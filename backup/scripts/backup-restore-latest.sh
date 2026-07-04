#!/usr/bin/env bash
set -Eeuo pipefail

# Restores the latest restic snapshots into a target directory.
#
# Usage (inside the backup container):
#   backup-restore-latest.sh [target-dir]
#
# Afterwards, restore each database with pg_restore (custom format), e.g.:
#   pg_restore --clean --if-exists --no-owner --no-acl \
#       --dbname="postgres://medplum:<pw>@postgres:5432/medplum" \
#       /restore/postgres/medplum/medplum.dump
#
# The Medplum binary storage is restored as a plain directory tree under
# <target>/data/medplum-binary and must be copied back into the
# `binary_data` volume (see README → Disaster recovery).

target="${1:-/restore}"
mkdir -p "${target}"

snapshot_host="${BACKUP_RESTIC_HOSTNAME:-hca-care}"

for name in medplum verification supplier_proxy studies_sync; do
    echo "Restoring latest ${name} dump..."
    restic restore "latest" \
        --host "${snapshot_host}" \
        --tag "${name}" \
        --target "${target}"
done

echo "Restoring latest binary storage snapshot..."
restic restore "latest" \
    --host "${snapshot_host}" \
    --tag binary \
    --target "${target}" \
    || echo "No binary snapshot found — skipping." >&2

echo ""
echo "Latest snapshots restored into ${target}."
echo "Dump files:"
find "${target}" -type f -name "*.dump" -print
