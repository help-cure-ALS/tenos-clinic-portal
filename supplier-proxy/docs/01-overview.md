# Supplier Integration Docs (Canonical)

This documentation is the technical reference for supplier integrations against the `supplier-proxy`.

- Base URL (behind Caddy): `/sapi`
- Service: Fastify + PostgreSQL
- Scope of this documentation: API contract, auth, retry, operations
- Not part of this step: external supplier website

## System Overview

```text
Mobile App (Patient/Caregiver/Doctor)
  -> POST /v1/provider-exchange/:integration_id/push
  -> GET  /v1/provider-exchange/:integration_id/pull
  -> POST /v1/provider-exchange/:integration_id/proposals/:proposalId/decision
  -> POST /v1/provider-exchange/:integration_id/transitions
                         |
                         v
                 supplier-proxy
          (encrypted at-rest, queue, retries)
                         |
                         v
                Supplier Endpoint (outbound)

Supplier System
  -> POST /v1/provider-exchange/proposals   (single global URL)
     body: { contract_id, proposals[] }
```

## Roles and Responsibilities

- `patient/caregiver/doctor` in the app: use integration tokens per concrete patient link (`integration_id`).
- `supplier system`: sends proposals to **one** global URL with a supplier org token.
- `hca-admin` (Care-Web): manages supplier directory, tokens, delivery config, workflow policy, replay.

## Single-URL Principle for Suppliers

Suppliers always get the same endpoint for inbound:

- `POST /v1/provider-exchange/proposals`

Routing is done via:

- `Authorization: Bearer <supplier_org_token>` (which supplier organization is sending)
- `contract_id` in the body (which integration/patient link is meant)

This means:

- Suppliers do **not** have to manage a URL per patient.
- Suppliers only need to set `contract_id` in the payload.

## Contract Identifier

- `integration_id` (UUID) is the contractual identifier between app integration and supplier.
- In outbound payloads this field is named `contract_id`.
- In inbound proposal requests, `contract_id` must be sent back.

## Core Flows

1. Linking requires a valid `verification_token_id` for a verified ALS patient and afterwards creates `integration_id` + integration token (app-side).
2. App pushes data (`/push`) -> proxy stores it encrypted and queues delivery.
3. Proxy delivers to the supplier endpoint (`delivery-config` per supplier organization).
4. Supplier sends proposals to the global inbound URL with `contract_id`.
5. App pulls proposals via `/pull`.
6. Decisions and transitions go through the integration routes.

## Verification Dependency for Linking

The two linking routes

- `POST /v1/provider-links/care-org`
- `POST /v1/provider-links/partner-app/accept`

only accept requests with a `verification_token_id`.

The `supplier-proxy` does not store any verification data from the `verification-service` itself; before creating an integration it only checks the already existing status endpoint:

- `GET /verify/tokens/:tokenId/status`

This keeps the proxy self-contained and reuses the same external verification contract as the `research-proxy`.

## Further Chapters

- [02-auth.md](./02-auth.md) - Authentication and signatures
- [03-outbound-hca-to-supplier.md](./03-outbound-hca-to-supplier.md) - Outbound contract
- [04-inbound-supplier-to-hca.md](./04-inbound-supplier-to-hca.md) - Inbound contract
- [05-errors-retries.md](./05-errors-retries.md) - Error codes, retry, dedupe
- [06-e2e-test-playbook.md](./06-e2e-test-playbook.md) - End-to-end test with `curl`/webhook
- [07-operations-runbook.md](./07-operations-runbook.md) - Operations, rotation, replay
- [08-contract-changelog.md](./08-contract-changelog.md) - Contract changes
