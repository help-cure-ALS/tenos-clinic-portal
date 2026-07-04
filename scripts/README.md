# Scripts

## merge-data.mjs

Merges all individual FHIR data files into batch-upload-ready bundles for Medplum.

Enrichment (ported from the former `bots/src/seed-clinics.ts`):
- Adds `http://help-cure-als.org/clinic-id` identifier to every Organization and Practitioner
- Copies Organization address to Practitioners that lack one

```bash
node scripts/merge-data.mjs
```

**Output:**
- `fhir/all-clinics.batch.json` — All clinics & practitioners (53 countries)
- `fhir/access-policies.batch.json` — Access policies (Clinician Portal, Verification Service, Mobile Care App)

ResearchStudies are loaded live by the `studies-sync` service — no static batch file. See the root README for the `studies-sync` operations section.

The output bundles use FHIR `type: "batch"` with `PUT` requests. Upload them via **Medplum Admin → Batch**.

## backup.sh

Creates timestamped SQL dumps of both databases (Medplum + Verification).

```bash
./scripts/backup.sh
```

Backups are saved to `backups/<timestamp>/`. Override the target directory:

```bash
BACKUP_DIR=/tmp ./scripts/backup.sh
```

Requires running Postgres containers (`docker compose up -d postgres verification-db`).

## restore.sh

Restores both databases from a backup directory.

```bash
./scripts/restore.sh backups/20260218-020000
```

Restart services after restore:

```bash
docker compose -f docker-compose.yml restart medplum-server verification-service
```
