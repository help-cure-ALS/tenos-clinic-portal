# 08 - Contract Changelog

This file versions the supplier integration contract at the API level.

## v1.0.0 (2026-03-10)

Initial canonical state for supplier integration in the `supplier-proxy`.

### Included

- Global inbound endpoint for suppliers:
  - `POST /v1/provider-exchange/proposals`
  - Body with `contract_id` + `proposals[]`
  - Auth via supplier org Bearer token
- Outbound delivery contract:
  - Body `{ contract_id, delivery_id, bundle }`
  - Headers `Idempotency-Key`, `X-HCA-Delivery-Id`
  - optional HMAC headers (`X-HCA-Timestamp`, `X-HCA-Signature`) per auth mode
- Inbound idempotency dedupe:
  - `Idempotency-Key` required
  - dedupe response: `accepted=0`, `deduplicated=true`
- Proposal upsert semantics:
  - `(integration_id, proposal_id)` is unique
  - the same `proposal_id` means update
- Delivery outbox:
  - persistent jobs/attempts
  - retry with backoff/jitter
  - deadline 30 days, then `failed_manual`

### Compatibility

- The legacy route `POST /v1/provider-exchange/:id/proposals` remains available.
- No schema changes to app push/pull responses in this state.

---

## Change Rules for New Versions

Document for every contract change:

1. Date + version.
2. Affected endpoints/headers/fields.
3. Backward compatibility (yes/no).
4. Required supplier changes.
5. Rollout notes (e.g. new headers optional first, required later).
