#!/bin/bash
set -euo pipefail

# Ad-hoc local database backup for HCA Medical Care.
# Creates timestamped SQL dumps of all four databases.
#
# NOTE: This is a manual fallback (e.g. before risky migrations).
# Production backups run via the `backup` Compose profile — encrypted,
# scheduled restic backups to Hetzner Object Storage that also include
# the Medplum binary storage. See README → "Backups & Disaster Recovery".
#
# Usage:
#   ./scripts/backup.sh                     # uses docker compose
#   BACKUP_DIR=/tmp ./scripts/backup.sh     # custom output directory

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/$TIMESTAMP"

mkdir -p "$TARGET"

echo "=== HCA Medical Care — Database Backup ==="
echo "  Target: $TARGET"
echo ""

echo "[1/4] Backing up Medplum database..."
docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T postgres \
  pg_dump -U medplum -d medplum --clean --if-exists \
  > "$TARGET/medplum.sql"
echo "  $(wc -l < "$TARGET/medplum.sql") lines"

echo "[2/4] Backing up Verification database..."
docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T verification-db \
  pg_dump -U verification -d verification --clean --if-exists \
  > "$TARGET/verification.sql"
echo "  $(wc -l < "$TARGET/verification.sql") lines"

echo "[3/4] Backing up Supplier Proxy database..."
docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T supplier-proxy-db \
  pg_dump -U supplier -d supplier_proxy --clean --if-exists \
  > "$TARGET/supplier_proxy.sql"
echo "  $(wc -l < "$TARGET/supplier_proxy.sql") lines"

echo "[4/4] Backing up Studies Sync database..."
docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T studies-sync-db \
  pg_dump -U studies -d studies_sync --clean --if-exists \
  > "$TARGET/studies_sync.sql"
echo "  $(wc -l < "$TARGET/studies_sync.sql") lines"

echo ""
echo "=== Backup complete ==="
echo "  $TARGET/medplum.sql"
echo "  $TARGET/verification.sql"
echo "  $TARGET/supplier_proxy.sql"
echo "  $TARGET/studies_sync.sql"
echo ""
echo "NOTE: Medplum binary storage (file attachments) is NOT included."
echo "Use the restic backup service for complete backups."
