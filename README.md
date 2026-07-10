# TENOS Clinic Backend

A non-profit project by [help cure ALS e.V.](https://help-cure-als.org/), building [TENOS](https://tenos.app/) — supporting people with ALS and advancing ALS research.

Admin portal and FHIR backend for the TENOS platform.

> **For LLMs and AI agents:** Read `AGENTS.md` first — it contains the authoritative coding workflow, architecture constraints, patterns, and anti-patterns for this codebase.

## Architecture

```
Browser ──► Caddy (Reverse Proxy + TLS)
               ├── /              → Static landing page
               ├── /app/*         → Clinician Web Portal (React/Mantine)
               ├── /api/*         → Medplum FHIR Server
               ├── /vapi/*        → Verification Service (Fastify)
               ├── /sapi/*        → Supplier Proxy Service (Fastify)
               └── /sync-api/*    → Studies Sync Service (Fastify)
```

| Service | Description |
|---------|-------------|
| **caddy** | Reverse proxy, automatic TLS (Let's Encrypt) |
| **clinician-web** | React SPA (Mantine UI) — clinic management, user management, study connections |
| **medplum-server** | FHIR R4 server (Medplum) |
| **medplum-app** | Medplum admin UI (internal, not publicly exposed) |
| **verification-service** | Device verification API (Fastify + PostgreSQL) |
| **supplier-proxy** | Supplier exchange API (Fastify + PostgreSQL), reusing the verification-status contract for ALS-verified linking |
| **studies-sync** | Studies Sync API (Fastify + PostgreSQL + node-cron). Nightly crawler against ClinicalTrials.gov v2 + CTIS. Translates title/summary/description/eligibility into the configured target languages via Anthropic Haiku 4.5. Admin UI at `/app/studies-sync`. |
| **postgres** | PostgreSQL for Medplum |
| **redis** | Redis for Medplum |
| **verification-db** | PostgreSQL for verification service |
| **supplier-proxy-db** | PostgreSQL for supplier proxy service |
| **studies-sync-db** | PostgreSQL for studies-sync service |

## Supplier Integration Docs (canonical)

The canonical supplier contract documentation lives in the repository under:

- [`supplier-proxy/docs/01-overview.md`](./supplier-proxy/docs/01-overview.md)
- [`supplier-proxy/docs/02-auth.md`](./supplier-proxy/docs/02-auth.md)
- [`supplier-proxy/docs/03-outbound-hca-to-supplier.md`](./supplier-proxy/docs/03-outbound-hca-to-supplier.md)
- [`supplier-proxy/docs/04-inbound-supplier-to-hca.md`](./supplier-proxy/docs/04-inbound-supplier-to-hca.md)
- [`supplier-proxy/docs/05-errors-retries.md`](./supplier-proxy/docs/05-errors-retries.md)
- [`supplier-proxy/docs/06-e2e-test-playbook.md`](./supplier-proxy/docs/06-e2e-test-playbook.md)
- [`supplier-proxy/docs/07-operations-runbook.md`](./supplier-proxy/docs/07-operations-runbook.md)
- [`supplier-proxy/docs/08-contract-changelog.md`](./supplier-proxy/docs/08-contract-changelog.md)

Note: These documents are the source of truth for contract details (endpoint schemas, headers, error codes).

## Prerequisites

- Docker & Docker Compose v2
- Node.js 20+ (for `scripts/merge-data.mjs`)
- Domain with DNS A record pointing to the server (production only)

---

## Development Setup

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` — dev defaults:

```
CADDY_SITE_ADDRESS=:80
CADDY_HTTP_PORT=8070
CADDY_HTTPS_PORT=8453

MEDPLUM_BASE_URL=http://localhost:8070/api/
MEDPLUM_APP_BASE_URL=http://localhost:3001/
MEDPLUM_STORAGE_BASE_URL=http://localhost:8070/api/storage/
MEDPLUM_ALLOWED_ORIGINS=http://localhost:8070,http://localhost:3001

MEDPLUM_REGISTER_ENABLED=true

MEDPLUM_ADMIN_EMAIL=admin@help-cure-als.org
MEDPLUM_ADMIN_PASSWORD=superadmin

POSTGRES_PASSWORD=medplum
REDIS_PASSWORD=medplum

MEDPLUM_PROJECT_ID=
VITE_MEDPLUM_CLIENT_ID=
VITE_SUPPLIER_API_URL=/sapi
VERIFICATION_MEDPLUM_CLIENT_ID=
VERIFICATION_MEDPLUM_CLIENT_SECRET=

VERIFICATION_DB_PASSWORD=verification
VERIFICATION_SERVICE_TOKEN=dev_service_token_1234567890abcdef
VERIFICATION_APP_AUTH_JWT_SECRET=dev_verification_app_auth_jwt_secret_1234567890abcdef
VERIFICATION_APP_AUTH_JWT_ISSUER=verification-service
VERIFICATION_APP_AUTH_JWT_AUDIENCE=verification-mobile
VERIFICATION_APP_AUTH_JWT_TTL_SECONDS=900
VERIFICATION_APP_AUTH_CHALLENGE_TTL_SECONDS=60
SUPPLIER_PROXY_DB_PASSWORD=supplier
SUPPLIER_MEDPLUM_CLIENT_ID=
SUPPLIER_MEDPLUM_CLIENT_SECRET=
SUPPLIER_SERVICE_TOKEN=dev_supplier_service_token_1234567890abcdef
SUPPLIER_APP_AUTH_JWT_SECRET=dev_supplier_app_auth_jwt_secret_1234567890abcdef
SUPPLIER_APP_AUTH_JWT_ISSUER=supplier-proxy
SUPPLIER_APP_AUTH_JWT_AUDIENCE=supplier-mobile
SUPPLIER_APP_AUTH_JWT_TTL_SECONDS=900
SUPPLIER_APP_AUTH_CHALLENGE_TTL_SECONDS=60
VERIFICATION_SERVICE_URL=http://verification-service:3002
SUPPLIER_LINK_REQUEST_TTL_MINUTES=30
SUPPLIER_MAX_PULL=200
SUPPLIER_PAYLOAD_KEYS_JSON={"1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}
SUPPLIER_PAYLOAD_ACTIVE_KEY_VERSION=1
SUPPLIER_INBOUND_IDEMPOTENCY_HOURS=72
SUPPLIER_DELIVERY_WORKER_INTERVAL_MS=5000
SUPPLIER_DELIVERY_WORKER_BATCH_SIZE=20
SUPPLIER_DELIVERY_RETRY_BASE_MS=60000
SUPPLIER_DELIVERY_RETRY_MAX_MS=21600000

STUDIES_SYNC_DB_PASSWORD=studies
STUDIES_MEDPLUM_CLIENT_ID=
STUDIES_MEDPLUM_CLIENT_SECRET=
STUDIES_ANTHROPIC_API_KEY=
```

The ID fields are created in step 3 and added to `.env` afterwards.

### Generate strong tokens/keys (recommended)

Use these commands to generate long random values and paste them into `.env`:

```bash
# 48 hex chars (~24 bytes entropy source)
openssl rand -hex 24
```

Example for all verification/supplier secrets:

```bash
VERIFICATION_SERVICE_TOKEN=$(openssl rand -hex 24)
VERIFICATION_APP_AUTH_JWT_SECRET=$(openssl rand -hex 48)
SUPPLIER_SERVICE_TOKEN=$(openssl rand -hex 24)
SUPPLIER_APP_AUTH_JWT_SECRET=$(openssl rand -hex 48)
SUPPLIER_PAYLOAD_KEY_V1=$(openssl rand -base64 32 | tr -d '\n')

echo "VERIFICATION_SERVICE_TOKEN=$VERIFICATION_SERVICE_TOKEN"
echo "VERIFICATION_APP_AUTH_JWT_SECRET=$VERIFICATION_APP_AUTH_JWT_SECRET"
echo "VERIFICATION_APP_AUTH_JWT_ISSUER=verification-service"
echo "VERIFICATION_APP_AUTH_JWT_AUDIENCE=verification-mobile"
echo "SUPPLIER_SERVICE_TOKEN=$SUPPLIER_SERVICE_TOKEN"
echo "SUPPLIER_APP_AUTH_JWT_SECRET=$SUPPLIER_APP_AUTH_JWT_SECRET"
echo "SUPPLIER_APP_AUTH_JWT_ISSUER=supplier-proxy"
echo "SUPPLIER_APP_AUTH_JWT_AUDIENCE=supplier-mobile"
echo "VERIFICATION_SERVICE_URL=http://verification-service:3002"
echo "SUPPLIER_PAYLOAD_KEYS_JSON={\"1\":\"$SUPPLIER_PAYLOAD_KEY_V1\"}"
echo "SUPPLIER_PAYLOAD_ACTIVE_KEY_VERSION=1"
```

`SUPPLIER_PAYLOAD_KEYS_JSON` must contain a base64-decoded 32-byte key per version (AES-256).

`VERIFICATION_SERVICE_URL` is the base URL that `supplier-proxy` uses for the existing
`GET /verify/tokens/:tokenId/status` check. In local mono-stack development that is the
internal Docker URL `http://verification-service:3002`; in production on separate
hardware it must be the externally or privately reachable Care/Verification URL.

### 2. Start services

```bash
docker compose up -d
```

This auto-loads `docker-compose.override.yml`:
- Vite dev server with hot reload for `clinician-web`
- Caddy on port **8070** (plain HTTP)
- Medplum Admin UI on port **3001**

| URL | Service |
|-----|---------|
| `http://localhost:8070/` | Landing page |
| `http://localhost:8070/app/` | Clinician Portal |
| `http://localhost:8070/api/` | Medplum FHIR API |
| `http://localhost:8070/sync-api/` | Studies Sync Admin API (only for logged-in `hca-admin`) |
| `http://localhost:3001/` | Medplum Admin UI |

### 3. Initial Medplum setup (first time only)

#### a) Log in to the Medplum Admin UI

On first start, Medplum creates a super-admin from your `.env` settings:

```
MEDPLUM_ADMIN_EMAIL=admin@help-cure-als.org
MEDPLUM_ADMIN_PASSWORD=<your chosen password>
```

Open `http://localhost:3001/` and log in with these credentials. Then create a new **Project** if none exists yet.

#### b) Get the Project ID

1. Go to `http://localhost:3001/admin/project`
2. Click the **Details** tab
3. Copy the `id` field

```
MEDPLUM_PROJECT_ID=<project-id>
```

#### c) Create ClientApplication for the Clinician Portal

1. Go to `http://localhost:3001/admin/project`
2. Click the **Clients** tab
3. Click **Create new client** → enter name: `Clinician Portal` → **OK**
4. Copy the `id` from the new ClientApplication

```
VITE_MEDPLUM_CLIENT_ID=<client-app-id>
```

#### d) Create ClientApplication for the Verification Service

1. Same as above: **Clients** tab → **Create new client** → name: `Verification Service`
2. Copy `id` → `VERIFICATION_MEDPLUM_CLIENT_ID`
3. Copy `secret` → `VERIFICATION_MEDPLUM_CLIENT_SECRET`

```
VERIFICATION_MEDPLUM_CLIENT_ID=<client-app-id>
VERIFICATION_MEDPLUM_CLIENT_SECRET=<client-app-secret>
```

#### e) Create ClientApplication for the Mobile Care App

1. Same as above: **Clients** tab → **Create new client** → name: `Mobile Care App`
2. Copy `id` and `secret` — these go into the `hca-mobile-app/.env` (see step l)

#### f) Create ClientApplication for the Supplier Proxy

1. Same as above: **Clients** tab → **Create new client** → name: `Supplier Proxy`
2. Copy `id` → `SUPPLIER_MEDPLUM_CLIENT_ID`
3. Copy `secret` → `SUPPLIER_MEDPLUM_CLIENT_SECRET`

```
SUPPLIER_MEDPLUM_CLIENT_ID=<client-app-id>
SUPPLIER_MEDPLUM_CLIENT_SECRET=<client-app-secret>
```

#### f2) Create ClientApplication for the Studies Sync

1. Same as above: **Clients** tab → **Create new client** → name: `Studies Sync`
2. Copy `id` → `STUDIES_MEDPLUM_CLIENT_ID`
3. Copy `secret` → `STUDIES_MEDPLUM_CLIENT_SECRET`

```
STUDIES_MEDPLUM_CLIENT_ID=<client-app-id>
STUDIES_MEDPLUM_CLIENT_SECRET=<client-app-secret>
```

Get an Anthropic API key from `https://console.anthropic.com/` and put it in:

```
STUDIES_ANTHROPIC_API_KEY=sk-ant-...
```

Without a valid key, the sync still runs but translations are skipped.

#### g) Generate FHIR batch bundles

This script merges the source data from `data/` and `fhir/` into uploadable batch bundles:

```bash
node scripts/merge-data.mjs
```

This generates `fhir/all-clinics.batch.json` and `fhir/access-policies.batch.json`.

Studies are **not** part of the batch bundles anymore — they are loaded live by the `studies-sync` service (see the [Studies Sync operations](#studies-sync-operations) section).

#### h) Upload Access Policies

1. Go to `http://localhost:3001/batch`
2. Paste the contents of `fhir/access-policies.batch.json` into the text field
3. Click **Submit**

This creates three AccessPolicy resources:

| Policy | ID | Permissions |
|--------|----|-------------|
| Clinician Portal | `access-policy-clinician-portal` | Organization (rw), Practitioner (rw), PractitionerRole (ro), ResearchStudy (rw), List (rw) |
| Verification Service | `access-policy-verification-service` | Organization (ro), Practitioner (rw), PractitionerRole (rw), Basic (rw), ResearchStudy (ro) |
| Mobile Care App | `access-policy-mobile-care` | ResearchStudy (ro), Organization (ro), Practitioner (ro), List (ro) |

#### i) Assign Access Policies to ClientApplications

1. Go to `http://localhost:3001/admin/project` → **Clients** tab
2. Click **Clinician Portal** → **Edit** tab → set `Access Policy` to `access-policy-clinician-portal` → **Save**
3. Click **Verification Service** → **Edit** tab → set `Access Policy` to `access-policy-verification-service` → **Save**
4. Click **Mobile Care App** → **Edit** tab → set `Access Policy` to `access-policy-mobile-care` → **Save**
5. Click **Supplier Proxy** → **Edit** tab → set `Access Policy` to `access-policy-verification-service` (requires `Organization` + `PractitionerRole` read for admin Bearer checks) → **Save**
6. Click **Studies Sync** → **Edit** tab → set `Access Policy` to `access-policy-clinician-portal` (needs `ResearchStudy` read/write for the CTgov/CTIS crawler) → **Save**

#### j) Upload clinic data + trigger initial studies backfill

1. Go to `http://localhost:3001/batch`
2. Paste contents of `fhir/all-clinics.batch.json` → **Submit** (1,181 resources)
3. Studies come from the live `studies-sync` service — trigger the initial backfill from your shell:
   ```bash
   docker compose run --rm studies-sync npm run once
   ```
   Runs ~25 min and pulls all ALS/MND trials from ClinicalTrials.gov + CTIS, with translations into the configured languages.

#### k) Restart with IDs

Add all IDs to `.env` and restart:

```bash
docker compose down && docker compose up
```

#### l) Configure Mobile App

The `hca-mobile-app/.env` must be configured with the IDs from the care server:

```
EXPO_PUBLIC_CARE_BASE_URL=http://localhost:8070/api/
EXPO_PUBLIC_CARE_CLIENT_ID=<Mobile Care App client id from step e>
EXPO_PUBLIC_CARE_CLIENT_SECRET=<Mobile Care App client secret from step e>

EXPO_PUBLIC_VERIFICATION_URL=http://localhost:8070/vapi
EXPO_PUBLIC_SUPPLIER_PROXY_URL=http://localhost:8070/sapi
```

For production, replace URLs accordingly:

```
EXPO_PUBLIC_CARE_BASE_URL=https://clinic.tenos.app/api/
EXPO_PUBLIC_VERIFICATION_URL=https://clinic.tenos.app/vapi
EXPO_PUBLIC_SUPPLIER_PROXY_URL=https://clinic.tenos.app/sapi
```

Supplier runtime quick checks:

- Supplier `Organization` must be `active=true`, tagged with `urn:hca:supplier|enabled`, and have `address[0].country`.
- API credentials and delivery config are managed in clinician web under `Suppliers -> Detail -> Delivery`.
- Supplier sends proposals to the global endpoint `POST /sapi/v1/provider-exchange/proposals`.
- Full Supplier contract/details are documented in [`supplier-proxy/docs`](./supplier-proxy/docs/01-overview.md).

### UI library (`@hca/mantine-workbench`)

The clinician portal uses [`hca-mantine-workbench`](https://github.com/help-cure-ALS/hca-mantine-workbench) — a generic Mantine v9 component library without domain logic. It is referenced as a pinned GitHub dependency in `web/package.json`:

```
"@hca/mantine-workbench": "github:help-cure-ALS/hca-mantine-workbench#v0.1.0"
```

- **Production builds** (`web/Dockerfile`) install it from GitHub like any other dependency — a plain clone of this repository builds without extra setup.
- **Local development** (`docker-compose.override.yml`) instead mounts a sibling checkout (`../hca-mantine-workbench`) into the dev container and symlinks it into `node_modules`, so library changes hot-reload without a release. If you don't work on the library itself, you don't need the sibling checkout — remove the mount or just don't touch it; the symlink step is only active in the dev override.

**Releasing a library change:**

1. Tag a new version in `hca-mantine-workbench` (e.g. `v0.2.0`, matching its `package.json` version).
2. Bump the ref in `web/package.json`.
3. Run `bun install` in `web/` to refresh `bun.lock`, commit both files.

### 4. Rebuild after code changes

```bash
docker compose up --build clinician-web
docker compose up --build verification-service
docker compose up --build supplier-proxy
```

---

## Production Setup

### 1. Clone and configure

```bash
git clone git@github.com:help-cure-ALS/tenos-care-portal.git
cd tenos-care-portal
cp .env.example .env
```

Edit `.env` — change all `<strong random>` to real secrets:

```
CADDY_SITE_ADDRESS=clinic.tenos.app
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443

MEDPLUM_BASE_URL=https://clinic.tenos.app/api/
MEDPLUM_APP_BASE_URL=http://localhost:3001/
MEDPLUM_STORAGE_BASE_URL=https://clinic.tenos.app/api/storage/
MEDPLUM_ALLOWED_ORIGINS=https://clinic.tenos.app,http://localhost:3001

MEDPLUM_REGISTER_ENABLED=true

MEDPLUM_ADMIN_EMAIL=admin@help-cure-als.org
MEDPLUM_ADMIN_PASSWORD=<strong random>

POSTGRES_PASSWORD=<strong random>
REDIS_PASSWORD=<strong random>

MEDPLUM_PROJECT_ID=
VITE_MEDPLUM_CLIENT_ID=
VITE_SUPPLIER_API_URL=/sapi
VERIFICATION_MEDPLUM_CLIENT_ID=
VERIFICATION_MEDPLUM_CLIENT_SECRET=

VERIFICATION_DB_PASSWORD=<strong random>
VERIFICATION_SERVICE_TOKEN=<strong random>
VERIFICATION_APP_AUTH_JWT_SECRET=<strong random, min 32 chars>
VERIFICATION_APP_AUTH_JWT_ISSUER=verification-service
VERIFICATION_APP_AUTH_JWT_AUDIENCE=verification-mobile
VERIFICATION_APP_AUTH_JWT_TTL_SECONDS=900
VERIFICATION_APP_AUTH_CHALLENGE_TTL_SECONDS=60
SUPPLIER_PROXY_DB_PASSWORD=<strong random>
SUPPLIER_MEDPLUM_CLIENT_ID=
SUPPLIER_MEDPLUM_CLIENT_SECRET=
SUPPLIER_SERVICE_TOKEN=<strong random>
SUPPLIER_APP_AUTH_JWT_SECRET=<strong random, min 32 chars>
SUPPLIER_APP_AUTH_JWT_ISSUER=supplier-proxy
SUPPLIER_APP_AUTH_JWT_AUDIENCE=supplier-mobile
SUPPLIER_APP_AUTH_JWT_TTL_SECONDS=900
SUPPLIER_APP_AUTH_CHALLENGE_TTL_SECONDS=60
VERIFICATION_SERVICE_URL=https://clinic.tenos.app/vapi
SUPPLIER_LINK_REQUEST_TTL_MINUTES=30
SUPPLIER_MAX_PULL=200
SUPPLIER_PAYLOAD_KEYS_JSON={"1":"<base64-32-byte-key>"}
SUPPLIER_PAYLOAD_ACTIVE_KEY_VERSION=1
SUPPLIER_INBOUND_IDEMPOTENCY_HOURS=72
SUPPLIER_DELIVERY_WORKER_INTERVAL_MS=5000
SUPPLIER_DELIVERY_WORKER_BATCH_SIZE=20
SUPPLIER_DELIVERY_RETRY_BASE_MS=60000
SUPPLIER_DELIVERY_RETRY_MAX_MS=21600000

STUDIES_SYNC_DB_PASSWORD=<strong random>
STUDIES_MEDPLUM_CLIENT_ID=
STUDIES_MEDPLUM_CLIENT_SECRET=
STUDIES_ANTHROPIC_API_KEY=<Anthropic Console Key>
```

### 2. Start services

```bash
docker compose -f docker-compose.yml up -d --build
```

### 2a. Mandatory post-deploy smoke checks

Run these checks after every deploy/restart. Treat this as a release gate.

```bash
curl -i https://clinic.tenos.app/api/healthcheck
curl -i https://clinic.tenos.app/vapi/healthz
curl -i https://clinic.tenos.app/sapi/healthz
curl -i https://clinic.tenos.app/sync-api/healthz
```

Expected:
- `/api/healthcheck` -> `200`
- `/vapi/healthz` -> `200`
- `/sapi/healthz` -> `200`
- `/sapi/v1/organizations` -> `200` (or `401` if token mismatch, but never `404`)
- `/sync-api/healthz` -> `200` (returns `{"status":"ok"}`)

### 3. Initial Medplum setup (first time only)

Open an SSH tunnel to access the Medplum Admin UI:

```bash
ssh -L 3001:localhost:3001 your-server
```

Then follow [Development Setup → Step 3, steps a–j](#3-initial-medplum-setup-first-time-only) at `http://localhost:3001/` to create the Project, ClientApplications, Access Policies, and upload data.

After adding the IDs to `.env`, restart:

```bash
docker compose -f docker-compose.yml up -d
```

The portal is now live at `https://clinic.tenos.app/app/login`.

#### Configure Mobile App (production)

Follow [step l)](#l-configure-mobile-app) from the dev setup, but use production URLs in `hca-mobile-app/.env`:

```
EXPO_PUBLIC_CARE_BASE_URL=https://clinic.tenos.app/api/
EXPO_PUBLIC_VERIFICATION_URL=https://clinic.tenos.app/vapi
EXPO_PUBLIC_SUPPLIER_PROXY_URL=https://clinic.tenos.app/sapi
```

### 3 (alt). Restore from backup

If you have a database backup from an existing instance instead of doing a fresh setup:

```bash
docker compose -f docker-compose.yml up -d postgres redis verification-db
# wait a few seconds for databases to be ready
./scripts/restore.sh <backup-dir>
```

Copy the IDs from the original `.env` into your new `.env`:

```
MEDPLUM_PROJECT_ID=<from original .env>
VITE_MEDPLUM_CLIENT_ID=<from original .env>
VERIFICATION_MEDPLUM_CLIENT_ID=<from original .env>
VERIFICATION_MEDPLUM_CLIENT_SECRET=<from original .env>
SUPPLIER_MEDPLUM_CLIENT_ID=<from original .env>
SUPPLIER_MEDPLUM_CLIENT_SECRET=<from original .env>
STUDIES_MEDPLUM_CLIENT_ID=<from original .env>
STUDIES_MEDPLUM_CLIENT_SECRET=<from original .env>
STUDIES_ANTHROPIC_API_KEY=<from original .env>
```

Then start all services:

```bash
docker compose -f docker-compose.yml up -d --build
```

---

## Environment Variables

All variables are documented in [`.env.example`](.env.example).

## Supplier runtime troubleshooting

### Fast diagnosis matrix

| Symptom | Primary cause | Verify | Fix |
|---------|---------------|--------|-----|
| `404` on `/sapi/*` | Caddy route not loaded (`/sapi` missing in active config) | `docker compose exec caddy sh -lc 'cat /etc/caddy/Caddyfile'` | Ensure `handle_path /sapi/* { reverse_proxy supplier-proxy:3003 }`, then restart Caddy |
| `401 invalid_token` on supplier app routes | app-auth JWT misconfigured (issuer/audience/secret mismatch) | Check `SUPPLIER_APP_AUTH_JWT_*` env and `/app-auth/issue` response | Align env, restart supplier-proxy and mobile app |
| `supplier-proxy` restart loop with `28P01` | DB auth mismatch for role `supplier` | `docker compose logs --tail=120 supplier-proxy` | Sync DB role password to runtime connection value (procedure below) |
| `supplier-proxy` exits on startup with `supplier-crypto` error | Invalid/missing payload key configuration | `docker compose logs --tail=120 supplier-proxy` | Set valid `SUPPLIER_PAYLOAD_KEYS_JSON` + `SUPPLIER_PAYLOAD_ACTIVE_KEY_VERSION` (base64 32-byte keys) |
| Deliveries stuck in `failed_manual` | Supplier endpoint/auth invalid or endpoint down too long | Care web: `Suppliers -> Detail -> Delivery` | Fix endpoint/auth config, then replay failed deliveries |

### Supplier DB password sync (deterministic recovery)

If `supplier-proxy` fails with `28P01`, run exactly:

```bash
PW=$(docker compose run --rm supplier-proxy node -e "const u=new URL(process.env.DATABASE_URL); process.stdout.write(decodeURIComponent(u.password));")
docker compose exec supplier-proxy-db psql -U supplier -d supplier_proxy -c "ALTER ROLE supplier WITH PASSWORD '$PW';"
docker compose up -d --force-recreate supplier-proxy
docker compose logs --tail=120 supplier-proxy
```

Then verify:

```bash
curl --resolve clinic.tenos.app:443:127.0.0.1 -k -i https://clinic.tenos.app/sapi/healthz
```

### Production curl notes

- In production, `localhost:8070` is often not exposed.
- Prefer domain checks (`https://clinic.tenos.app/...`) or local SNI check via `--resolve`.

### IDs — where they come from

| Variable | Source | Used by |
|----------|--------|---------|
| `MEDPLUM_PROJECT_ID` | Medplum Admin → Project → `id` | verification-service, clinician-web |
| `VITE_MEDPLUM_CLIENT_ID` | Medplum Admin → ClientApplication → `id` | clinician-web (build-time) |
| `VITE_SUPPLIER_API_URL` | compose/web build arg (default `/sapi`) | clinician-web (build-time) |
| `VERIFICATION_MEDPLUM_CLIENT_ID` | Medplum Admin → ClientApplication → `id` | verification-service |
| `VERIFICATION_MEDPLUM_CLIENT_SECRET` | Medplum Admin → ClientApplication → `secret` | verification-service |
| `VERIFICATION_APP_AUTH_JWT_SECRET` | generated secret (required, >=32 chars) | verification-service app JWT signing/verify |
| `VERIFICATION_APP_AUTH_JWT_ISSUER` | static issuer string | verification-service + mobile audience check |
| `VERIFICATION_APP_AUTH_JWT_AUDIENCE` | static audience string | verification-service + mobile audience check |
| `SUPPLIER_MEDPLUM_CLIENT_ID` | Medplum Admin → ClientApplication → `id` | supplier-proxy |
| `SUPPLIER_MEDPLUM_CLIENT_SECRET` | Medplum Admin → ClientApplication → `secret` | supplier-proxy |
| `SUPPLIER_SERVICE_TOKEN` | generated secret (required, >=16 chars) | supplier-proxy admin/service routes (`X-Service-Token`) |
| `SUPPLIER_APP_AUTH_JWT_SECRET` | generated secret (required, >=32 chars) | supplier-proxy app JWT signing/verify |
| `SUPPLIER_APP_AUTH_JWT_ISSUER` | static issuer string | supplier-proxy + mobile audience check |
| `SUPPLIER_APP_AUTH_JWT_AUDIENCE` | static audience string | supplier-proxy + mobile audience check |
| `SUPPLIER_PAYLOAD_KEYS_JSON` | generated AES-256 key map (`{"1":"<base64-32-byte-key>"}`) | supplier-proxy payload encryption-at-rest |
| `SUPPLIER_PAYLOAD_ACTIVE_KEY_VERSION` | active key version from key map | supplier-proxy encrypt/write path |
| `STUDIES_SYNC_DB_PASSWORD` | generated password for the `studies` DB role | studies-sync-db bootstrap + studies-sync runtime |
| `STUDIES_MEDPLUM_CLIENT_ID` | Medplum Admin → ClientApplication `Studies Sync` → `id` | studies-sync (Upsert ResearchStudy) |
| `STUDIES_MEDPLUM_CLIENT_SECRET` | Medplum Admin → ClientApplication `Studies Sync` → `secret` | studies-sync (Upsert ResearchStudy) |
| `STUDIES_ANTHROPIC_API_KEY` | Anthropic Console → API Key | studies-sync (Haiku 4.5 translation). Optional: leave empty → sync still runs, translations are skipped |

These IDs are stored in the Medplum database. After a database restore they remain the same — just copy them from the original `.env`.

---

## Studies Sync operations

The `studies-sync` service runs daily at **03:00 UTC** (configurable in the admin UI at `/app/studies-sync`) and syncs ClinicalTrials.gov + CTIS into Medplum as `ResearchStudy` resources. On changes, title, summary, description, why-stopped, and eligibility criteria are translated into the configured target languages via Anthropic Haiku 4.5.

### Admin UI

Only `hca-admin` sees the **Studies Sync** menu item in the sidebar ("Configuration" section).

- **Conditions**: free-text list passed 1:1 to CTgov/CTIS. Default after migration: `Amyotrophic Lateral Sclerosis`, `Motor Neuron Disease`.
- **Target languages**: multi-select across all 11 mobile app languages (de, es, fr, it, ja, nl, pl, pt, ro, tr, zh). EN is the source and cannot be disabled.
- **CTgov / CTIS / Translation**: individually toggleable (e.g. temporarily disable translation when the Anthropic key is missing).
- **Cron expression**: node-cron format. Changes take effect on the next container start (deliberate — the active job is not rescheduled mid-flight).
- **Sync now**: starts a manual run (fire-and-forget). Duplicate runs are prevented by a DB guard.
- **History**: last 50 runs with counters (CTgov ↑ new/changed, = unchanged, ∑ total) and error message if any. Auto-refreshes every 10 s.

### Safe ramp-up (recommended before the first real backfill)

Three stages — each validates part of the pipeline without burning money:

```bash
# 1) Dry run — fetches everything, maps to FHIR, checks hashes, writes NOTHING.
#    The summary shows how many trials it *would* create/update.
docker compose run --rm studies-sync npm run once:dev -- --dry-run

# 2) Smoke — 1 study per registry, real upsert into Medplum,
#    translation OFF. Then check in the Medplum admin under ResearchStudy
#    that the record arrived cleanly.
docker compose run --rm studies-sync npm run once:dev -- --limit 1 --no-translate

# 3) Translation smoke — 1 study, 1 language, real translation.
#    Cost: ~$0.005. Then check ext/summary-de on the record.
docker compose run --rm studies-sync npm run once:dev -- --limit 1 --translate --languages de
```

If stage 3 produces a sensible German text in `ext/summary-de`, the whole pipeline is validated. Only then:

### First backfill / recovery

Trigger once manually after deploy so the first cron doesn't have to wait up to 20 hours:

```bash
# Prod (uses the dist build inside the container):
docker compose -f docker-compose.yml build studies-sync
docker compose -f docker-compose.yml run --rm studies-sync npm run once

# Dev (with override, tsx watch, no build round needed):
docker compose run --rm studies-sync npm run once:dev
```

Runs synchronously in the container shell, prints a JSON result at the end, and exits 0 on success. Takes ~25 min for ~1,500 CTgov trials + ~50 CTIS trials + 11 languages.

The dev container (`Dockerfile.dev`, activated via `docker-compose.override.yml`) mounts `studies-sync/src` and `studies-sync/migrations` — code changes apply live via `tsx watch`. The prod container installs prod deps only and runs `node dist/index.js`, which is why there are two separate `once` scripts.

### Costs

- **APIs**: CTgov v2 + CTIS Public API require no API key and have no documented rate limit. We sleep 1 s between CTgov detail fetches to stay polite.
- **Anthropic**: initial backfill roughly $10–15 (300 studies × 5 free-text fields × 11 languages on Haiku 4.5). Nightly delta afterwards under $1/month, because hash dedup only allows re-translation on actual text changes.

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `404` on `/sync-api/*` | Caddy route missing | `docker compose exec caddy sh -lc 'cat /etc/caddy/Caddyfile'` — must contain `reverse_proxy /sync-api/* studies-sync:3004` |
| `403 admin_only` in the admin UI | User is not a Medplum super admin | In the Medplum admin: Project → Members → User → `admin: true` |
| Run completes but `translated_count = 0` | `STUDIES_ANTHROPIC_API_KEY` missing or invalid | Set the key in `.env`, `docker compose up -d studies-sync` |
| Run completes but `ctgov_upserted = 0` on the very first run | Medplum client lacks a `ResearchStudy` write policy | Assign access policy `access-policy-clinician-portal` to the `Studies Sync` ClientApplication (setup step 3i.6) |
| Run stuck at `status = running` | Previous process crashed mid-run | `UPDATE studies_sync_runs SET status='failed', error_message='stale' WHERE status='running';` in the studies-sync DB — then trigger again |

---

## FHIR Data & Access Policies

Source data and access policies live in `data/` and `fhir/`. Run `merge-data.mjs` to generate batch bundles:

```bash
node scripts/merge-data.mjs
```

**Output** (all in `fhir/`):

| File | Contents |
|------|----------|
| `fhir/all-clinics.batch.json` | 53 countries, 1,181 Organizations |
| `fhir/access-policies.batch.json` | 3 AccessPolicy resources |

Upload each bundle via **Medplum Admin → Batch**.

ResearchStudy resources are managed by the `studies-sync` service (see [Studies Sync operations](#studies-sync-operations)) — no static batch, no `data/studies/` folder anymore.

See [`data/clinics/README.md`](data/clinics/README.md) for the clinic data structure.

---

## Backups & Disaster Recovery

Two layers:

| Layer | What | When |
|-------|------|------|
| **Offsite backups** (production) | `backup` Compose profile — scheduled, encrypted restic backups of all 4 databases **and** the Medplum binary storage to Hetzner Object Storage | Always on in production |
| **Local ad-hoc dumps** | `scripts/backup.sh` / `scripts/restore.sh` — plain SQL dumps to the local `backups/` folder | Manual safety net, e.g. before risky migrations |

### Offsite backups (production)

The `backup` service (same pattern as in `tenos-sync-vault`) runs `pg_dump --format=custom` for all four databases and streams the dumps into an encrypted [restic](https://restic.net/) repository on Hetzner Object Storage (S3 API). The Medplum binary storage volume (file attachments) is backed up as a directory snapshot in the same repository.

What is included:

| Snapshot path | Contents |
|---------------|----------|
| `postgres/medplum/medplum.dump` | Medplum FHIR database (authoritative for all FHIR resources incl. studies) |
| `postgres/verification/verification.dump` | Verification service database |
| `postgres/supplier_proxy/supplier_proxy.dump` | Supplier proxy database (incl. encrypted payloads) |
| `postgres/studies_sync/studies_sync.dump` | Studies sync config + run audit trail |
| `/data/medplum-binary` | Medplum binary storage (file attachments) |

Snapshot paths are constant — restic keeps history via snapshots and deduplicates unchanged data. Retention (`restic forget --prune`) keeps 14 daily, 8 weekly, and 3 monthly snapshots per path by default.

#### Setup

1. Create a Hetzner Object Storage bucket (e.g. `hca-care-backups`) and an S3 credential pair in the Hetzner console.
2. Configure `.env`:

```
COMPOSE_PROFILES=backup
BACKUP_RESTIC_REPOSITORY=s3:hel1.your-objectstorage.com/hca-care-backups/prod
BACKUP_S3_REGION=hel1
BACKUP_S3_ACCESS_KEY_ID=<access-key>
BACKUP_S3_SECRET_ACCESS_KEY=<secret-key>
BACKUP_RESTIC_PASSWORD=<long random password>
```

3. **Store `BACKUP_RESTIC_PASSWORD` somewhere outside the server** (password manager of the org). Without it, backups cannot be decrypted — a lost restic password means lost backups.
4. Start:

```bash
docker compose -f docker-compose.yml up -d --build backup
```

The repository is initialized automatically on first start. A backup runs immediately (`BACKUP_RUN_ON_START=true`), then every `BACKUP_INTERVAL_SECONDS` (default 6 h).

#### Monitoring

Set `BACKUP_PING_URL` to a [healthchecks.io](https://healthchecks.io/) or Uptime Kuma push URL. The backup container pings it after every **successful** run — if the ping stays out, you get alerted. Recommended check period: backup interval + grace (e.g. 6 h + 1 h).

Manual checks:

```bash
# Recent logs
docker compose logs --tail=50 backup

# List snapshots + verify repository integrity
docker compose exec backup backup-check.sh

# Trigger a backup run manually
docker compose exec backup backup-once.sh
```

Optionally set `BACKUP_RUN_CHECK_AFTER_BACKUP=true` temporarily (or run `backup-check.sh` weekly) to verify repository integrity.

#### Restore a single database (running server)

To roll back one database on a running server (e.g. after a failed migration):

```bash
# Fetch the latest snapshots from object storage
docker compose exec backup backup-restore-latest.sh /tmp/restore

# Restore one database (example: verification)
docker compose exec backup sh -c 'pg_restore --clean --if-exists --no-owner --no-acl \
  --dbname="postgres://verification:$VERIFICATION_DB_PASSWORD@verification-db:5432/verification" \
  /tmp/restore/postgres/verification/verification.dump'

docker compose restart verification-service
```

For the other databases, use the matching `pg_restore` command from the [disaster recovery](#disaster-recovery-fresh-server) section. To restore an older state instead of `latest`, find the snapshot ID with `docker compose exec backup restic snapshots` and pass it to `restic restore <id> --target ...` inside the backup container.

#### Disaster recovery (fresh server)

1. Provision a new server, install Docker, clone the repo, copy the saved `.env` (all IDs/secrets — see [Restore from backup](#3-alt-restore-from-backup)).
2. Start only the databases:

```bash
docker compose -f docker-compose.yml up -d postgres redis verification-db supplier-proxy-db studies-sync-db
docker compose -f docker-compose.yml up -d --build backup
```

3. Restore the latest snapshots into the backup container:

```bash
docker compose exec backup backup-restore-latest.sh /tmp/restore
```

4. Restore each database (custom format → `pg_restore`):

```bash
docker compose exec backup sh -c 'pg_restore --clean --if-exists --no-owner --no-acl \
  --dbname="postgres://medplum:$POSTGRES_PASSWORD@postgres:5432/medplum" \
  /tmp/restore/postgres/medplum/medplum.dump'
docker compose exec backup sh -c 'pg_restore --clean --if-exists --no-owner --no-acl \
  --dbname="postgres://verification:$VERIFICATION_DB_PASSWORD@verification-db:5432/verification" \
  /tmp/restore/postgres/verification/verification.dump'
docker compose exec backup sh -c 'pg_restore --clean --if-exists --no-owner --no-acl \
  --dbname="postgres://supplier:$SUPPLIER_PROXY_DB_PASSWORD@supplier-proxy-db:5432/supplier_proxy" \
  /tmp/restore/postgres/supplier_proxy/supplier_proxy.dump'
docker compose exec backup sh -c 'pg_restore --clean --if-exists --no-owner --no-acl \
  --dbname="postgres://studies:$STUDIES_SYNC_DB_PASSWORD@studies-sync-db:5432/studies_sync" \
  /tmp/restore/postgres/studies_sync/studies_sync.dump'
```

5. Restore the binary storage into the `binary_data` volume (the volume is mounted read-only in the backup container, so copy via a throwaway container):

```bash
docker compose exec backup sh -c 'tar -C /tmp/restore/data/medplum-binary -cf /tmp/binary.tar .'
docker compose cp backup:/tmp/binary.tar /tmp/binary.tar
docker run --rm -v tenos-care-portal_binary_data:/target -v /tmp/binary.tar:/binary.tar:ro \
  alpine sh -c 'tar -C /target -xf /binary.tar'
```

6. Start everything and run the [post-deploy smoke checks](#2a-mandatory-post-deploy-smoke-checks):

```bash
docker compose -f docker-compose.yml up -d --build
```

> **Restore drill:** test this procedure on a throwaway Hetzner VM about once a quarter. An untested backup is not a backup.

### Local ad-hoc dumps

```bash
./scripts/backup.sh                    # dumps all 4 DBs to backups/<YYYYMMDD-HHMMSS>/
BACKUP_DIR=/tmp ./scripts/backup.sh    # custom output directory
./scripts/restore.sh backups/20260218-020000
```

Note: `studies_sync.sql` only contains the sync config + run audit trail. All actual ResearchStudy data lives in the Medplum DB — a `medplum.sql` dump is authoritative for the studies themselves. Local dumps do **not** include the Medplum binary storage.

Restart services after restore:

```bash
docker compose restart medplum-server verification-service supplier-proxy studies-sync
```

---

## User Roles

| Role | Access |
|------|--------|
| HCA-Admin | All clinics, practitioners, studies, verification |
| Clinic-Admin | Own clinic, users, verification |
| Clinic-Verifier | Dashboard, verifications, tokens |
| Clinic-Member | Dashboard, tokens (read-only) |

---

## Project Structure

```
├── Caddyfile                    # Reverse proxy config
├── docker-compose.yml           # Production services
├── docker-compose.override.yml  # Dev overrides (auto-loaded)
├── .env.example                 # Environment template
├── medplum-entrypoint.js        # Generates medplum.config.json from env (Node.js, distroless image)
├── medplum-app-entrypoint.sh    # Patches Medplum admin UI with env tokens
├── backup/                      # Restic offsite-backup sidecar (Hetzner Object Storage)
├── landing/                     # Static landing page
├── web/                         # Clinician Web Portal (React/Mantine/Vite)
│   ├── Dockerfile               # Production build (bun → caddy)
│   └── Dockerfile.dev           # Dev server (Vite HMR)
├── verification-service/        # Device verification API (Fastify)
├── supplier-proxy/              # Supplier exchange API (Fastify)
├── studies-sync/                # Studies Sync API (Fastify + node-cron + Anthropic Haiku 4.5)
├── scripts/                     # merge-data, backup, restore
├── data/
│   ├── clinics/data/            # ALS clinic FHIR bundles (53 countries)
│   └── studies/data/            # Clinical study FHIR bundle
└── fhir/                        # Access policies + generated batch bundles
```

## License

[MIT](./LICENSE) © [help cure ALS e.V.](https://help-cure-als.org/)
