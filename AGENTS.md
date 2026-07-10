# AGENTS.md — TENOS Clinic Backend

## What is the Care-Backend?

The Care-Backend is a multi-service monorepo providing three core functions:

1. **Verification Service** (`/vapi`) — physician verification, invitation system, admin API
2. **Supplier Proxy** (`/sapi`) — medical-aid ordering and exchange between patients, physicians, and suppliers
3. **Web Portal** (`/`) — React-based admin dashboard for clinics, studies, and suppliers

All services run behind a Caddy reverse proxy and share one Medplum FHIR instance.

**Domain:** `clinic.tenos.app`
**Organisation:** [help cure ALS e.V.](https://help-cure-als.org/)

## Before you do ANYTHING

### Step 1: Load context
1. **This file** (`AGENTS.md`)
2. **`docs/architecture.md`** — service architecture, auth strategies, DB schema
3. **The referenced source files** — read the actual code

### Step 2: Understand, don't guess
- **NEVER** make assumptions about code you haven't read
- **NEVER** call Medplum APIs without using the existing Medplum helpers
- **ALWAYS** check first which of the 3 services is affected — they have separate codebases, separate DBs, separate auth
- **When in doubt: ASK.**

### ⚠️ NO HALLUCINATIONS — source citations are mandatory

**Background:** LLMs tend to generate plausible-sounding but invented content — endpoints that don't exist, services that work differently than described, ports that are wrong. With 3 independent services, each with its own DB and auth, the risk is especially high.

**Every factual statement** in code, documentation, or commit messages **must be traceable to a concrete, verifiable source:**

1. **No invented endpoints, ports, or features.** Write ONLY what you have verified via `grep`, `Read`, or explicit instruction from a maintainer. Unsure whether an endpoint exists → read the service's `routes.ts`. Unsure which port → read the service's `index.ts`.

2. **No plausible-sounding filler.** Honestly short documentation beats inflated documentation with invented content. Wrong endpoint paths or port numbers can cost other LLMs or developers hours of debugging.

3. **Cite sources for non-obvious statements.** If you write "the verification service runs on port 3002", cite the source: `(verification-service/src/index.ts:51)`. If you write "Caddy routes /vapi/* to verification", cite: `(Caddyfile:8-9)`.

4. **Mark unverified statements explicitly.** If you cannot verify a statement, mark it: `[UNVERIFIED]`. A maintainer decides.

5. **Verification workflow for documentation:**
   - BEFORE writing: `grep` / `Read` to check facts
   - WHILE writing: write down only what is verified
   - AFTER writing: re-read — "Can I cite a source for every line?"

**Rule of thumb:** if you cannot back a statement with a file path or line number, it does not belong in the documentation.

### Step 3: Think systemically — MANDATORY
**BEFORE every code change, answer these questions — not from memory, but by checking against the code:**

- Which service is affected? (Verification, Supplier, Web — do NOT mix them up)
- Which DB is touched? (verification-db, supplier-db, medplum-db — separate instances!)
- Does the mobile app use this endpoint? If yes: which file in `hca-medical-mobile-app`?
- Is the change backwards compatible for already-deployed app versions?

### Step 4: No commit without maintainer approval

## Rules

### Code quality
- TypeScript, Zod for input validation
- Fastify handlers with Zod schemas
- Parameterized SQL (no string concatenation)
- Medplum access ONLY through the existing helpers (`medplum.ts` in each service)

### Architecture constraints

#### Service routing (Caddy) — do NOT change
```
clinic.tenos.app/vapi/*   → Verification Service (port 3002)
clinic.tenos.app/sapi/*   → Supplier Proxy (port 3003)
clinic.tenos.app/api/*    → Medplum Server (port 8103)
clinic.tenos.app/app/*    → Web Portal (WEB_UPSTREAM)
clinic.tenos.app/*        → Landing page (static)
```

**Note:** `/app/*` is the web-portal route, not `/*`. The `/*` catch-all is the (static) landing page.

The path prefixes (`/vapi`, `/sapi`, `/api`) are hard-coded in the app clients:
- `/vapi` → `hca-medical-mobile-app/src/lib/verificationClient.ts`
- `/sapi` → `hca-medical-mobile-app/src/services/supplierExchange/`

**Change these prefixes and the app breaks.** No exceptions.

#### 4 auth strategies (do NOT mix them up)

| Service | Endpoint type | Auth method | Description |
|---------|--------------|-------------|-------------|
| Verification Service | App endpoints (`/vapi/verify/*`) | Ed25519 PoP | Same auth as the Vault (challenge → signature → JWT) |
| Verification Service | Admin endpoints (`/vapi/admin/*`) | Medplum JWT | Admin user authenticated via Medplum |
| Supplier Proxy | All app endpoints (`/sapi/*`) | Ed25519 PoP | App-side auth for the medical-aid workflow |
| Web Portal | All endpoints | Medplum Auth | OAuth-like flow via Medplum |

**Anti-pattern:**
```typescript
// WRONG: using Medplum auth on an app endpoint
// The app has no Medplum login — it uses Ed25519 PoP!
// Note: in code ONLY /verify/request (Caddy adds the /vapi prefix)
app.post("/verify/request", { preHandler: medplumAuth }, async (req) => { ... });

// RIGHT:
app.post("/verify/request", { preHandler: app.auth }, async (req) => {
    const subjectId = req.user.sub; // Ed25519-based JWT
});
```

#### 3 databases (separate instances)
```
docker-compose.yml:
  verification-db (PostgreSQL) → ONLY verification-service/src/db.ts
  supplier-db (PostgreSQL)     → ONLY supplier-proxy/src/db.ts
  medplum-db (PostgreSQL)      → Medplum server (NEVER access directly)
```

**NO cross-DB queries.** Every service has its own `db.ts` with its own connection pool.

**Anti-pattern:**
```typescript
// WRONG: accessing the supplier DB from the verification service
import { pool } from '../supplier-proxy/src/db'; // ← NEVER

// RIGHT: every service uses only its own DB
import { pool } from './db';
```

#### Medplum (FHIR server) — helpers only

Medplum is the FHIR R4 server for master data: Practitioners, Organizations, Studies, Locations.

```typescript
// RIGHT: Medplum queries through the medplum.ts helpers
import { findPractitioner, searchOrganizations } from './medplum';
const practitioner = await findPractitioner(medplum, identifier);

// WRONG: direct Medplum client calls in route handlers
const practitioner = await medplum.searchOne('Practitioner', { identifier });
```

Add new FHIR queries as functions in the service's `medplum.ts`, not inline in routes. That keeps queries reusable and testable.

## Established patterns

### Pattern 1: Fastify route with Ed25519 auth
```typescript
// verification-service/src/routes.ts and supplier-proxy/src/routes.ts
// Note: in code WITHOUT the /vapi prefix — Caddy adds it
app.post("/verify/request", { preHandler: app.auth }, async (req: any, reply) => {
    const body = VerifyRequestSchema.parse(req.body);
    const subjectId = req.user.sub;
    // ... DB access via pool from ./db.ts ...
});
```

### Pattern 2: Docker Compose service definition
```yaml
services:
  verification-service:
    build: ./verification-service
    ports: ["4100:4100"]
    depends_on: [verification-db, medplum]
    environment:
      - DATABASE_URL=postgresql://...
      - MEDPLUM_BASE_URL=http://medplum:8103

  supplier-proxy:
    build: ./supplier-proxy
    ports: ["4200:4200"]
    depends_on: [supplier-db, medplum]
```

New environment variables MUST be documented in `docker-compose.yml` AND in `.env.example`.

### Pattern 3: Supplier proxy encryption
```typescript
// supplier-proxy/src/crypto.ts — keyring-based encryption
// Key rotation via versioned keys
const key = keyring.keys.get(version);
```

Supplier data is encrypted with a keyring. Do NOT use the Vault key — that is a separate system.

### Verification service endpoints (source: `verification-service/src/routes.ts`)

**App auth (Ed25519 PoP):**
- POST `/app-auth/register` — register device
- POST `/app-auth/challenge` — request challenge
- POST `/app-auth/issue` — JWT in exchange for signature

**Verification flow (app auth):**
- POST `/verify/request` — request 6-digit code
- GET `/verify/status/:requestId` — poll status
- POST `/verify/revoke` — revoke token (app)

**Verification flow (clinician auth / Medplum JWT):**
- GET `/verify/pending` — open requests
- GET `/verify/tokens` — active tokens
- POST `/verify/confirm/:code` — confirm code (physician)
- POST `/verify/reject/:code` — reject code (physician)

**Admin (HCA admin only):**
- POST `/admin/clinics/:clinicId/verification` — toggle verification
- POST `/admin/invitations` — create invitation
- GET `/admin/invitations` — list invitations
- DELETE `/admin/invitations/:id` — delete invitation

**Invitations (public):**
- GET `/invitations/:token` — invitation details
- POST `/invitations/:token/redeem` — redeem invitation

**Clinic user management (clinic admin):**
- GET `/clinics/:clinicId/users` — list users
- PATCH `/users/:userId/permissions` — change permissions
- PATCH `/users/:userId/name` — change name
- DELETE `/users/:userId` — delete user

**Service-to-service (X-Service-Token):**
- GET `/verify/tokens/:tokenId/status` — token validation (for the research server)

*The app reaches these endpoints as `/vapi/...` via Caddy routing.*

## Service matrix (overview)

| Service | Port | Auth (app) | Auth (admin) | DB | App client | Docs |
|---------|------|------------|--------------|-----|------------|------|
| Verification Service | 3002 | Ed25519 PoP (`/app-auth/*`) | Medplum JWT (Bearer) | verification-db | `verificationClient.ts` | `AGENTS.md` (this file) |
| Supplier Proxy | 3003 | Ed25519 PoP (`/app-auth/*`) | Medplum JWT (Bearer) + supplier token | supplier-db | `src/services/supplierExchange/` | `supplier-proxy/docs/01-08` |
| Web Portal | WEB_UPSTREAM | — | Medplum Auth | medplum-db (via Medplum) | — | — |
| Medplum (FHIR) | 8103 | — | Medplum client | medplum-db | — | medplum.config.json |

## Cross-repo dependency: app → care

| Care endpoint | App client code | Description |
|--------------|-----------------|-------------|
| `/vapi/app-auth/*` | `src/lib/verificationClient.ts` | Device registration & Ed25519 PoP auth |
| `/vapi/verify/*` | `src/lib/verificationClient.ts` | Physician verification (app side) |
| `/vapi/admin/*` | (not used by the app) | Admin operations (web portal) |
| `/vapi/invitations/*` | `src/lib/verificationClient.ts` | Redeem invitations |
| `/vapi/clinics/*` | `src/lib/verificationClient.ts` | Clinic user management |
| `/sapi/*` | `src/services/supplierExchange/` | Medical-aid workflow |

**When you change an API contract**, check the app client file for compatibility. If not backwards compatible → coordinate the change across both repos.

## Mandatory checklist before implementing

1. **Which service?** → Verification, Supplier, or Web? Don't mix them up.
2. **Which auth?** → Ed25519 PoP (app endpoints) or Medplum JWT (admin/web)?
3. **Which DB?** → verification-db, supplier-db, or medplum-db? No cross-DB queries.
4. **Medplum affected?** → New FHIR query? Add a helper in `medplum.ts`, not inline.
5. **Caddy routing affected?** → Do NOT change path prefixes (`/vapi`, `/sapi`, `/api`).
6. **Docker Compose affected?** → New env vars, volumes, dependencies?
7. **App compatibility?** → Does an API contract used by the app change?
8. **Input validated?** → Zod schema before business logic?
9. **SQL parameterized?** → `$1`, `$2` — no string concatenation.

## What NOT to do
- No direct Medplum REST calls — always use the `medplum.ts` helpers
- No cross-DB queries between the 3 PostgreSQL instances
- No changes to the path prefixes (`/vapi`, `/sapi`, `/api`)
- No new services without Docker Compose integration
- No Ed25519 auth on admin endpoints or vice versa
- No commits without maintainer approval

## Project structure

```
Caddyfile                      — reverse-proxy config (HTTPS, path routing)
docker-compose.yml             — all services + 3 DBs + Medplum + Caddy
medplum.config.json            — Medplum server configuration (generated from env, gitignored)

verification-service/
  src/
    index.ts                   — Fastify server start (port 3002)
    routes.ts                  — ~20 endpoints (verification, admin, invitations, tokens)
    db.ts                      — PostgreSQL pool (verification-db)
    medplum.ts                 — Medplum FHIR client helpers
    types.ts                   — TypeScript types + Zod schemas

supplier-proxy/
  src/
    index.ts                   — Fastify server start (port 3003)
    routes.ts                  — ~35 endpoints (requests, offers, prescriptions, deliveries, workflows)
    db.ts                      — PostgreSQL pool (supplier-db)
    medplum.ts                 — Medplum FHIR client helpers
    crypto.ts                  — keyring-based encryption for supplier data
    delivery.ts                — delivery logic
    verification.ts            — physician verification for prescriptions
    types.ts                   — TypeScript types + Zod schemas
  docs/                        — supplier contract documentation (source of truth!):
                                   01-overview.md, 02-auth.md, 03-outbound-hca-to-supplier.md,
                                   04-inbound-supplier-to-hca.md, 05-errors-retries.md,
                                   06-e2e-test-playbook.md, 07-operations-runbook.md,
                                   08-contract-changelog.md
                                   REQUIRED READING before changing the supplier proxy.

web/
  src/                         — React SPA (Vite + TypeScript)
    pages/
      clinics/                 — clinic management
      clinic-studies/          — clinical studies
      suppliers/               — supplier dashboard + workflow policies
    hooks/                     — usePractitioners, useClinicStudies, etc.
    stores/
      auth.ts                  — Medplum-based auth
    components/
      suppliers/               — supplier UI components
  vite.config.ts

studies-sync/                  — live sync ClinicalTrials.gov + CTIS (Fastify + Anthropic Haiku 4.5)
backup/                        — restic offsite-backup sidecar (Hetzner Object Storage)
scripts/                       — merge-data, local backup/restore utilities

docs/
  architecture.md
```

## Stack
- **Backend:** Fastify + TypeScript (2 services: Verification port 3002, Supplier port 3003)
- **Frontend:** React + Vite + TypeScript (web portal)
- **FHIR server:** Medplum (self-hosted, port 8103)
- **Databases:** 3× PostgreSQL (verification-db, supplier-db, medplum-db)
- **Reverse proxy:** Caddy (auto-HTTPS)
- **Auth:** Ed25519 PoP (app calls), Medplum JWT (admin/web)
- **Validation:** Zod
- **Crypto:** TweetNaCl (Ed25519, app auth), custom keyring (supplier encryption)
- **Containers:** Docker Compose

## Canonical sources (source of truth)

| Topic | Canonical file | Note |
|-------|----------------|------|
| Verification endpoints | `verification-service/src/routes.ts` | ~1230 lines, all endpoints |
| Supplier endpoints | `supplier-proxy/src/routes.ts` | ~3100 lines, all endpoints |
| Supplier contract (external) | `supplier-proxy/docs/01-08` | REQUIRED READING before changes |
| Verification DB schema | `verification-service/migrations/` | 4 migrations |
| Supplier DB schema | `supplier-proxy/migrations/` | 5 migrations |
| Caddy routing | `Caddyfile` | do not change path prefixes |
| Web portal code | `web/src/` | React SPA with Vite |
| Architecture overview | `docs/architecture.md` | short version; AGENTS.md is authoritative |

## Related repos

| Repo | Relationship | Check when changing |
|------|--------------|---------------------|
| `hca-medical-mobile-app` | Client — uses `/vapi` and `/sapi` | `src/lib/verificationClient.ts`, `src/services/supplierExchange/` |
| `tenos-sync-vault` | Independent (own auth system) | — |
| `hca-medical-research` | Similar architecture, but standalone | — |
