# 02 - Authentication

This chapter describes all auth paths from `src/routes.ts` and the signature construction from `src/delivery.ts`.

## Token Types in the System

| Type | Header | Scope | Source/Management |
|---|---|---|---|
| App Device JWT | `Authorization: Bearer <jwt>` | app-facing public routes + linking | issued via `/app-auth/register|challenge|issue` |
| Service Token (optional) | `X-Service-Token` | service routes | env `SUPPLIER_SERVICE_TOKEN` |
| Verification Service Check | `X-Service-Token` (proxy -> verification-service) | linking gate for ALS-verified patients | external `GET /verify/tokens/:tokenId/status` contract |
| Integration Token | `Authorization: Bearer <token>` | `/v1/provider-exchange/:id/*` | created per integration, hash in `supplier_integration_tokens` |
| Supplier Org Token | `Authorization: Bearer <token>` | `POST /v1/provider-exchange/proposals` | per supplier organization, hash in `supplier_org_tokens` |
| Admin Clinician Token | `Authorization: Bearer <token>` | `/v1/admin/*` | Medplum `/auth/me`, only `hca-admin` (without `organizationId`) |

## App Device Auth

App-facing routes use a device-bound JWT flow:

1. `POST /app-auth/register` (register ed25519 public key)
2. `POST /app-auth/challenge` (fetch a one-time challenge)
3. `POST /app-auth/issue` (sign the challenge, receive JWT)
4. App routes with `Authorization: Bearer <jwt>`

JWT claims:

- `device_id`
- `tv` (token_version)
- `iss`, `aud`, `exp`

Server-side validation:

- JWT signature (`APP_AUTH_JWT_SECRET`)
- `iss`/`aud` match
- `device_id` exists and is `active`
- `tv` must match `app_devices.token_version`

Important:

- The device JWT only answers the question "which app device is talking to the proxy?".
- For linking, it is no longer sufficient on its own.

## Linking Gate via Verification Status

The two linking routes

- `POST /v1/provider-links/care-org`
- `POST /v1/provider-links/partner-app/accept`

additionally require in the request body:

- `verification_token_id` (UUID)

Before creating an integration, the proxy calls the already existing verification status endpoint:

- `GET <VERIFICATION_SERVICE_URL>/verify/tokens/:tokenId/status`
- Header: `X-Service-Token: <VERIFICATION_SERVICE_TOKEN>`

Only `status = "valid"` allows linking.

Important architecture rule:

- The `supplier-proxy` does not take over verification ownership here.
- It only uses the existing external status contract, exactly like the `research-proxy`.
- There is deliberately no `device_id` matching between `supplier-proxy` and `verification-service`, because both services maintain their own app identities.

## Integration Auth (App <-> Proxy)

The integration routes validate:

1. Bearer token is present and not empty.
2. SHA-256 token hash exists in `supplier_integration_tokens` and is not revoked.
3. Token belongs to the requested `:id` (`integration_mismatch` otherwise `403`).
4. Integration status is `active` (`integration_inactive` otherwise `403`).
5. Supplier organization in Medplum exists + is active + has the `urn:hca:supplier|enabled` tag.

Error codes (excerpt):

- `401 missing_token`
- `401 invalid_token`
- `400 invalid_request`
- `403 token_not_found`
- `403 token_revoked`
- `403 verification_service_unreachable`
- `403 integration_mismatch`
- `403 integration_inactive`

## Supplier Inbound Auth (Supplier -> Proxy)

`POST /v1/provider-exchange/proposals` checks:

1. Bearer token is present.
2. SHA-256 token hash exists in `supplier_org_tokens` and is not revoked.
3. Supplier organization in Medplum exists + is active + enabled.

Error codes (excerpt):

- `401 missing_token`
- `401 invalid_token`
- `403 supplier_inactive`

## Outbound Auth (Proxy -> Supplier Endpoint)

The proxy sends outbound requests to the `endpoint_url` stored in `supplier_delivery_configs`.

Supported modes:

- `bearer`:
  - Header `Authorization: Bearer <auth_secret>`
- `hmac`:
  - Header `X-HCA-Timestamp: <ISO-8601>`
  - Header `X-HCA-Signature: sha256=<hex>`
  - Signature input: `<timestamp>.<raw-json-body>`
  - Algorithm: `HMAC-SHA256(secret, input)`

In all modes:

- `Content-Type: application/json`
- `Idempotency-Key: <uuid>`
- `X-HCA-Delivery-Id: <delivery-id>`

## Token/Secret Storage

- Integration tokens and supplier org tokens: only hashed values (`SHA-256`) in the DB.
- App device keys: public keys in `app_devices`, challenges in `app_auth_challenges`.
- Delivery secrets: encrypted (`AES-256-GCM`) in `supplier_delivery_configs`.
- Delivery payloads and proposal payloads: encrypted (`AES-256-GCM`) at rest.

## What Suppliers Must Do

1. Send the correct Bearer token for inbound proposals.
2. Always include a valid `Idempotency-Key`.
3. For outbound HMAC, implement the signature check on the supplier side.
4. Adopt token rotations promptly in their own configuration.
