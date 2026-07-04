# 05 - Errors, Retry, Dedupe

## HTTP Error Codes (relevant groups)

| Status | Error code | Context |
|---|---|---|
| 400 | `invalid_request` | schema/validation error |
| 400 | `idempotency_key_required` | inbound proposals without/with invalid Idempotency-Key |
| 400 | `invalid_cursor` | `/pull` with an invalid cursor |
| 401 | `missing_token` | Bearer header missing |
| 401 | `invalid_token` | token unknown/empty |
| 401 | `unauthorized` | optional app/service token set but wrong |
| 403 | `admin_only` | admin route with a non-admin clinician |
| 403 | `integration_mismatch` | token does not match the requested integration |
| 403 | `integration_inactive` | integration not active |
| 403 | `supplier_inactive` | supplier inactive/deleted/tag missing |
| 403 | `policy_violation` | transition not allowed per workflow policy |
| 404 | `contract_not_found` | global inbound with unknown contract_id |
| 404 | `organization_not_found` | supplier organization missing |
| 404 | `policy_not_found` | no policy for the country |
| 404 | `delivery_not_found` | replay on an unknown delivery |
| 409 | `contract_inactive` | contract_id exists but is not active |
| 409 | `supplier_not_available` | supplier exists but is inactive/not enabled |
| 409 | `integration_not_active` | rotate token on a non-active integration |
| 409 | `delivery_not_replayable` | replay only for `failed_manual` |
| 422 | `missing_supplier_country` | supplier without a valid country code |
| 500 | `server_error` | unexpected server error |

## Delivery Job Status

`supplier_delivery_jobs.status`:

- `pending`
- `retrying`
- `delivered`
- `failed_manual`

## Retry Strategy (Outbound)

Source: `src/delivery.ts`.

Retryable outcomes:

- network error (`network_error`)
- timeout (`timeout`)
- HTTP `408`, `429`, `>=500`

Not retryable:

- other `4xx` (e.g. `401`, `403`, `404`, `422`)
- local configuration errors (`delivery_config_invalid_auth_mode`, `payload_missing`, etc.)

Backoff:

- Base: `SUPPLIER_DELIVERY_RETRY_BASE_MS` (default `60000`)
- Maximum: `SUPPLIER_DELIVERY_RETRY_MAX_MS` (default `21600000`)
- Exponential + jitter (`0.8 .. 1.2`)

Deadline:

- per job `delivery_deadline_at = now() + 30 days`
- when the deadline is reached -> `failed_manual`

## Inbound Dedupe (Supplier -> Proxy)

Table: `supplier_inbound_idempotency`.

- Key: `(integration_id, endpoint, idempotency_key)`
- Expiry: automatic cleanup delete of expired rows during request processing
- Window: `SUPPLIER_INBOUND_IDEMPOTENCY_HOURS` (default `72`)

Response for a deduplicated request:

```json
{ "ok": true, "accepted": 0, "deduplicated": true }
```

## Proposal Update Rule

If a supplier sends the same `(contract_id, proposal_id)` again:

- the proposal is updated (upsert)
- the pull cursor sees the update again (via a new `id` sequence value on conflict update)

## What Suppliers Must Do

1. On HTTP `5xx`/timeout, repeat the request with the **same** `Idempotency-Key`.
2. On functional errors (`4xx`), fix payload/auth, do not retry blindly.
3. Keep `proposal_id` stable when an existing proposal is meant to be updated.
