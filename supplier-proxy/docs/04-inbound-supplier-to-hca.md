# 04 - Inbound: Supplier -> HCA

This chapter is the canonical supplier inbound contract.

## Endpoint (global, single URL)

- `POST /v1/provider-exchange/proposals`
- Auth: `Authorization: Bearer <supplier_org_token>`
- Required header: `Idempotency-Key`

Important:

- This URL is the same for all patients/contracts.
- Target routing is done in the body via `contract_id`.

## Request Schema

```json
{
  "contract_id": "uuid",
  "proposals": [
    {
      "proposal_id": "string",
      "catalog_id": "string (optional)",
      "name": "string",
      "category": "mobility|transfer|communication|respiratory|nutrition|daily_living",
      "reason": "string (optional)",
      "created_at": "ISO-8601 datetime"
    }
  ]
}
```

Validation (from `UpsertGlobalProposalsSchema`/`InboundProposalSchema`):

- `contract_id`: UUID (required)
- `proposals`: 1..500 elements
- `proposal_id`: non-empty string
- `name`: non-empty string
- `category`: enum
- `created_at`: `zod datetime`

## Header Rules

- `Authorization` must be a valid supplier org token.
- `Idempotency-Key` must match the regex: `^[A-Za-z0-9._:-]+$`
- Maximum length of `Idempotency-Key`: 128 characters

If the `Idempotency-Key` is missing/invalid:

- `400 { "error": "idempotency_key_required" }`

## Routing and Security Rules

The server checks:

1. Token -> supplier organization (`supplier_org_tokens`).
2. `contract_id` must match `supplier_integrations.integration_id` of the same organization.
3. Integration must be `active`.

Error cases:

- `404 contract_not_found`
- `409 contract_inactive`
- `401/403` for auth cases

## Dedupe and Update Semantics

### Request Dedupe (Idempotency-Key)

- Scope: `(integration_id, endpoint, idempotency_key)`
- Window: `SUPPLIER_INBOUND_IDEMPOTENCY_HOURS` (default 72h)
- On duplicate:

```json
{ "ok": true, "accepted": 0, "deduplicated": true }
```

### Proposal Upsert (proposal_id)

- Unique key: `(integration_id, proposal_id)`
- The same `proposal_id` for the same `contract_id` means **update**.
- The update is made visible in a pull-cursor-safe way (the DB `id` is re-assigned on conflict).

## Success Response

```json
{
  "ok": true,
  "contract_id": "uuid",
  "accepted": 2,
  "deduplicated": false
}
```

Note: In the deduplicated case, no `contract_id` is currently returned.

## Example `curl`

```bash
curl -i "https://clinic.tenos.app/sapi/v1/provider-exchange/proposals" \
  -H "Authorization: Bearer <SUPPLIER_ORG_TOKEN>" \
  -H "Idempotency-Key: sup-$(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{
    "contract_id": "4489c94e-0771-488b-901d-3576e1fee969",
    "proposals": [
      {
        "proposal_id": "sup-123",
        "name": "NIV-Beatmungsgeraet (BiPAP/CPAP)",
        "category": "respiratory",
        "reason": "ALSFRS Atmung = 2",
        "created_at": "2026-03-10T12:50:00.000Z"
      }
    ]
  }'
```

## Legacy Route (internal/compatibility)

Still available:

- `POST /v1/provider-exchange/:id/proposals`

This route uses the integration Bearer token and is not the preferred supplier contract.
