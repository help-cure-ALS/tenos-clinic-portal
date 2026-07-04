# Architecture — TENOS Care Backend

## Overview

```
                        care.tenos.app
                             │
                         ┌───┴───┐
                         │ Caddy │  (auto-HTTPS, reverse proxy)
                         └───┬───┘
              ┌──────────┬───┼──────────┬──────────┐
              │          │   │          │          │
         /vapi/*    /sapi/* /api/*    /app/*       /*
              │          │   │          │          │
              ▼          ▼   ▼          ▼          ▼
        Verification  Supplier Medplum  Web-Portal  Landing
        Service       Proxy    FHIR     (SPA)       (Static)
        :3002         :3003    :8103    WEB_UPSTREAM /srv/landing
              │          │     │
              ▼          ▼     ▼
        verif-db   supplier-db medplum-db
        (Postgres) (Postgres)  (Postgres)
```

## Verification Service

### Purpose
Doctor verification for the app. When a doctor wants to care for a patient, they must verify themselves (e.g. via invitation code or admin approval).

### Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/healthz` | No | health check |
| POST | `/app-auth/register` | No | register device (Ed25519 PoP) |
| POST | `/app-auth/challenge` | No | request challenge |
| POST | `/app-auth/issue` | No | issue JWT |
| POST | `/verify/request` | App-Auth | request 6-digit code |
| GET | `/verify/status/:requestId` | App-Auth | poll status |
| POST | `/verify/revoke` | App-Auth | revoke token |
| GET | `/verify/pending` | Clinician | open requests |
| GET | `/verify/tokens` | Clinician | active tokens |
| POST | `/verify/confirm/:code` | Clinician | confirm code |
| POST | `/verify/reject/:code` | Clinician | reject code |
| POST | `/admin/clinics/:clinicId/verification` | HCA-Admin | toggle verification |
| POST | `/admin/invitations` | HCA-Admin | create invitation |
| GET | `/admin/invitations` | HCA-Admin | list invitations |
| DELETE | `/admin/invitations/:id` | HCA-Admin | delete invitation |
| GET | `/invitations/:token` | No | invitation details (public) |
| POST | `/invitations/:token/redeem` | No | redeem invitation (public) |
| GET | `/clinics/:clinicId/users` | Clinic-Admin | list users |
| PATCH | `/users/:userId/permissions` | Clinic-Admin | change permissions |
| PATCH | `/users/:userId/name` | Clinic-Admin | change name |
| DELETE | `/users/:userId` | Clinic-Admin | delete user |
| GET | `/verify/tokens/:tokenId/status` | Service-Token | token validation (research server) |

### DB Schema
- `verification_requests` — verification requests with status and code
- `invitations` — invitation codes for clinicians
- `app_devices` — registered devices (Ed25519 PoP)
- `app_auth_challenges` — auth challenges (60s TTL)

## Supplier Proxy

### Purpose
Mediation between patients and medical aid suppliers. Patients make requests, doctors prescribe, suppliers deliver.

### Endpoints (~35 total)

**App-Auth:**
- `/app-auth/register`
- `/app-auth/challenge`
- `/app-auth/issue`

**Provider-Links:**
- `/v1/organizations`
- `/v1/provider-links/care-org`
- `/v1/provider-links/partner-app/request`
- `/v1/provider-links/requests:token`
- `/v1/provider-links/partner-app/accept`

**Provider-Exchange:**
- `/v1/provider-exchange:id/disconnect`
- `/v1/provider-exchange:id/push`
- `/v1/provider-exchange/proposals`
- `/v1/provider-exchange:id/proposals`
- `/v1/provider-exchange:id/pull`
- `/v1/provider-exchange:id/proposals/:proposalId/decision`
- `/v1/provider-exchange:id/transitions`

**Workflow-Policy:**
- `/v1/workflow-policy` (GET/POST)

**Admin:**
- `/v1/admin/workflow-policy` (GET/POST)
- `/v1/admin/workflow-policies`
- `/v1/admin/suppliers:orgId/*` (auth-token, integrations, delivery-config, delivery-status, delivery-attempts, delivery-test)
- `/v1/admin/integrations:id/*`
- `/v1/admin/deliveries:id/replay`

Full endpoint reference: `supplier-proxy/docs/01-08`

### Encryption
- Supplier data is encrypted with a keyring (`crypto.ts`)
- Key rotation via versioned keys

## Web Portal

### Purpose
Admin dashboard for clinics and suppliers. React SPA with Vite.

### Pages
- `/` — dashboard
- `/login` — login (Medplum auth)
- `/clinics` — clinic management
- `/clinic-profile` — clinic profile
- `/clinic-studies` — clinical studies
- `/practitioners` — doctor management
- `/studies` — studies overview
- `/suppliers` — supplier dashboard
- `/users` — user management
- `/verifications` — verifications overview
- `/invite` — redeem invitation

### Auth
Medplum-based login. The web portal uses the `@medplum/core` client for auth and FHIR queries.

## Auth Strategies

| Auth type | Used by | Validation | Description |
|----------|--------------|---------|-------------|
| Ed25519 PoP (App-Auth) | App → `/vapi/app-auth/*`, `/sapi/app-auth/*` | own JWT (each service has its own JWT secret) | same mechanism as Vault |
| Clinician (Medplum JWT) | Web → `/vapi/verify/*` admin routes | Medplum Bearer token → practitioner identity | doctor/clinic admin |
| HCA-Admin (Medplum JWT) | Web → `/vapi/admin/*` | Medplum JWT + `isHcaAdmin` check | system admins only |
| X-Service-Token | Research → `/vapi/verify/tokens/:id/status` | header `X-Service-Token` | server-to-server |
| Supplier-Token | Supplier → `/sapi/v1/...` (outbound callbacks) | `supplier_org_tokens` | supplier auth |
