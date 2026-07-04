#!/bin/bash
set -euo pipefail

# Database restore for HCA Medical Care.
# Restores SQL dumps created by scripts/backup.sh into all four databases.
# Dumps that are missing in the backup directory are skipped with a warning
# (older backups may only contain medplum + verification).
#
# Usage:
#   ./scripts/restore.sh backups/20260218-013000
#   ./scripts/restore.sh /path/to/backup/directory

if [ $# -eq 0 ]; then
  echo "Usage: $0 <backup-directory>"
  echo ""
  echo "Example:"
  echo "  $0 backups/20260218-013000"
  exit 1
fi

BACKUP_PATH="$1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Resolve relative paths from project root
if [[ ! "$BACKUP_PATH" = /* ]]; then
  BACKUP_PATH="$PROJECT_DIR/$BACKUP_PATH"
fi

if [ ! -f "$BACKUP_PATH/medplum.sql" ]; then
  echo "Error: $BACKUP_PATH/medplum.sql not found"
  exit 1
fi

restore_db() {
  local label="$1" file="$2" service="$3" user="$4" db="$5"
  if [ ! -f "$BACKUP_PATH/$file" ]; then
    echo "  Skipping $label — $file not found in backup."
    return 0
  fi
  echo "Restoring $label database..."
  docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T "$service" \
    psql -U "$user" -d "$db" -q \
    < "$BACKUP_PATH/$file" 2>&1 | tail -5
  echo "  Done."
}

echo "=== HCA Medical Care — Database Restore ==="
echo "  Source: $BACKUP_PATH"
echo ""

restore_db "Medplum"        "medplum.sql"        "postgres"          "medplum"      "medplum"
restore_db "Verification"   "verification.sql"   "verification-db"   "verification" "verification"
restore_db "Supplier Proxy" "supplier_proxy.sql" "supplier-proxy-db" "supplier"     "supplier_proxy"
restore_db "Studies Sync"   "studies_sync.sql"   "studies-sync-db"   "studies"      "studies_sync"

echo ""
echo "=== Restore complete ==="
echo "  Restart services after restore:"
echo "  docker compose -f docker-compose.yml restart medplum-server verification-service supplier-proxy studies-sync"
