# 03 - Outbound: HCA -> Supplier

This chapter describes the actual delivery contract from `src/routes.ts` (`/push`) and `src/delivery.ts` (worker + HTTP call).

## Trigger

App sends:

- `POST /v1/provider-exchange/:integration_id/push`
- Auth: integration Bearer token
- Body:

```json
{
  "bundle": { "resourceType": "Bundle", "type": "collection", "entry": [] }
}
```

Server behavior:

1. Payload is stored encrypted in `supplier_pushes`.
2. A delivery job is created in `supplier_delivery_jobs` (`status=pending`).
3. API responds immediately with:

```json
{
  "ok": true,
  "accepted": 0,
  "delivery_id": "uuid"
}
```

Note: `accepted` is the number of `bundle.entry` items in the incoming bundle.

## Outbound HTTP Request to the Supplier

The worker builds the request as follows:

- Method: `POST`
- URL: `supplier_delivery_configs.endpoint_url` (per `organization_id`)
- Body:

```json
{
  "contract_id": "integration_id-uuid",
  "delivery_id": "delivery-job-uuid",
  "bundle": { "...": "FHIR bundle payload" }
}
```

### Headers (always)

- `Content-Type: application/json`
- `Idempotency-Key: <delivery-job-idempotency-key>`
- `X-HCA-Delivery-Id: <delivery_id>`

### Headers per Auth Mode

- `bearer`:
  - `Authorization: Bearer <supplier_auth_secret>`
- `hmac`:
  - `X-HCA-Timestamp: <ISO timestamp>`
  - `X-HCA-Signature: sha256=<hex(hmac_sha256(secret, "<timestamp>.<body>"))>`

## Supplier Response Contract

- `2xx`: delivery is considered successful (`delivered`).
- `408`, `429`, `5xx`: retryable.
- Other `4xx`: not retryable -> `failed_manual`.
- Network/timeout errors: retryable.

Details on retry/backoff: [05-errors-retries.md](./05-errors-retries.md)

## Example: Expected Supplier Endpoint

The supplier should provide a `POST` endpoint that:

1. Checks auth (Bearer or HMAC).
2. Validates `contract_id`.
3. Deduplicates by `delivery_id`/`Idempotency-Key`.
4. Acknowledges quickly with `200`/`202`.

Minimal response:

```json
{ "ok": true }
```

## What Suppliers Must Do

1. Process `contract_id` internally as the integration reference.
2. Use `delivery_id` and/or `Idempotency-Key` for dedupe.
3. On temporary errors, prefer sending `5xx` (so the proxy retries), do not drop silently.
4. Keep the endpoint reachable and keep timeouts small.
