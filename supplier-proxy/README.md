# Supplier Proxy Service

Fastify service for supplier exchange (`/sapi` behind Caddy).

## Canonical Supplier Docs

Contract details (endpoints, headers, schemas, error codes, retry rules) are canonically documented in:

- [`docs/01-overview.md`](./docs/01-overview.md)
- [`docs/02-auth.md`](./docs/02-auth.md)
- [`docs/03-outbound-hca-to-supplier.md`](./docs/03-outbound-hca-to-supplier.md)
- [`docs/04-inbound-supplier-to-hca.md`](./docs/04-inbound-supplier-to-hca.md)
- [`docs/05-errors-retries.md`](./docs/05-errors-retries.md)
- [`docs/06-e2e-test-playbook.md`](./docs/06-e2e-test-playbook.md)
- [`docs/07-operations-runbook.md`](./docs/07-operations-runbook.md)
- [`docs/08-contract-changelog.md`](./docs/08-contract-changelog.md)

This `README` intentionally remains a short operator overview.

## Runtime

- Port: `3003`
- Base path behind Caddy: `/sapi`
- Health: `GET /healthz`

## Minimal Environment

- `DATABASE_URL` (required)
- `MEDPLUM_BASE_URL` (default `http://medplum-server:8103/`)
- `MEDPLUM_CLIENT_ID` / `MEDPLUM_CLIENT_SECRET`
- `SUPPLIER_SERVICE_TOKEN` (required, min 16, non-placeholder)
- `APP_AUTH_JWT_SECRET` (required, min 32)
- `APP_AUTH_JWT_ISSUER` (required)
- `APP_AUTH_JWT_AUDIENCE` (required)
- `VERIFICATION_SERVICE_URL` (required)
- `VERIFICATION_SERVICE_TOKEN` (required, shared service token for `/verify/tokens/:tokenId/status`)
- `SUPPLIER_PAYLOAD_KEYS_JSON` (required, key map)
- `SUPPLIER_PAYLOAD_ACTIVE_KEY_VERSION` (required)

Optional:

- `APP_AUTH_JWT_TTL_SECONDS`
- `APP_AUTH_CHALLENGE_TTL_SECONDS`
- `SUPPLIER_INBOUND_IDEMPOTENCY_HOURS`
- `SUPPLIER_DELIVERY_WORKER_INTERVAL_MS`
- `SUPPLIER_DELIVERY_WORKER_BATCH_SIZE`
- `SUPPLIER_DELIVERY_RETRY_BASE_MS`
- `SUPPLIER_DELIVERY_RETRY_MAX_MS`

## Generate required secrets

```bash
SUPPLIER_SERVICE_TOKEN=$(openssl rand -hex 24)
VERIFICATION_SERVICE_TOKEN=$(openssl rand -hex 24)
APP_AUTH_JWT_SECRET=$(openssl rand -hex 48)
SUPPLIER_PAYLOAD_KEY_V1=$(openssl rand -base64 32 | tr -d '\n')

echo "SUPPLIER_SERVICE_TOKEN=$SUPPLIER_SERVICE_TOKEN"
echo "APP_AUTH_JWT_SECRET=$APP_AUTH_JWT_SECRET"
echo "APP_AUTH_JWT_ISSUER=supplier-proxy"
echo "APP_AUTH_JWT_AUDIENCE=supplier-mobile"
echo "VERIFICATION_SERVICE_URL=http://verification-service:3002"
echo "VERIFICATION_SERVICE_TOKEN=$VERIFICATION_SERVICE_TOKEN"
echo "SUPPLIER_PAYLOAD_KEYS_JSON={\"1\":\"$SUPPLIER_PAYLOAD_KEY_V1\"}"
echo "SUPPLIER_PAYLOAD_ACTIVE_KEY_VERSION=1"
```

Notes:

- `SUPPLIER_SERVICE_TOKEN`: min 16 chars, no placeholder values.
- `APP_AUTH_JWT_SECRET`: min 32 chars, no placeholder values.
- `VERIFICATION_SERVICE_URL`: local mono-stack usually `http://verification-service:3002`; production on separate hardware must point to the reachable Care/Verification base URL.
- `VERIFICATION_SERVICE_TOKEN`: same shared service token that the verification-service expects on `X-Service-Token`.
- `SUPPLIER_PAYLOAD_KEYS_JSON`: versioned AES-256 key map (`{"1":"<base64-32-byte-key>"}`).

Note on env names:

- In the service code, the route variables are named `LINK_REQUEST_TTL_MINUTES` and `MAX_PULL`.
- In `docker-compose.yml` these are mapped from `SUPPLIER_LINK_REQUEST_TTL_MINUTES` and `SUPPLIER_MAX_PULL`.

## Security Snapshot

- Tokens are stored hashed (`SHA-256`).
- Payloads and delivery secrets are stored encrypted with key-versioned `AES-256-GCM`.
- Linking requires a valid `verification_token_id`; for this, the proxy checks the existing verification status endpoint externally against the `verification-service`.
- The service fails fast at startup on an invalid crypto key configuration.
- The service fails fast at startup on missing/weak `SUPPLIER_SERVICE_TOKEN`, `APP_AUTH_JWT_SECRET`, and `VERIFICATION_SERVICE_TOKEN`.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run start
```
