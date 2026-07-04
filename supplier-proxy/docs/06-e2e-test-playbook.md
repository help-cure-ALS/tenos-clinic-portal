# 06 - End-to-End Test Playbook

Goal: a developer can fully verify outbound and inbound once against real endpoints.

## Prerequisites

- Running Care server at `https://care.tenos.app/sapi`
- Available:
  - `supplier_org_token` (Supplier API access)
  - `integration_id` (contract)
  - `integration_token` (app/integration Bearer)
- Supplier delivery endpoint is configured (`delivery-config`) and reachable

Optional for tests:

- `webhook.site` or `requestcatcher.com` as a temporary supplier endpoint

## A) Health and Basic Checks

```bash
curl -i "https://care.tenos.app/sapi/healthz"
```

Expected: `200 {"ok":true}`

## B) Outbound Test (App -> Proxy -> Supplier)

### 0. Check the linking prerequisite

Before a new contract can be created, the app needs a valid
`verification_token_id` of an ALS-verified patient.

The proxy itself checks this proof via the existing verification status endpoint:

```bash
curl -i "https://care.tenos.app/vapi/verify/tokens/<verification_token_id>/status" \
  -H "X-Service-Token: <verification_service_token>"
```

Expected:

- `200`
- `{"status":"valid", ...}`

Without a valid status, the following linking routes must fail:

- `POST /sapi/v1/provider-links/care-org`
- `POST /sapi/v1/provider-links/partner-app/accept`

### 1. Push from the integration

```bash
curl -i "https://care.tenos.app/sapi/v1/provider-exchange/<integration_id>/push" \
  -H "Authorization: Bearer <integration_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "bundle": {
      "resourceType": "Bundle",
      "type": "collection",
      "entry": []
    }
  }'
```

Expected:

- `200`
- `{"ok":true,"accepted":0,"delivery_id":"..."}`

### 2. Check the supplier endpoint

A `POST` must arrive at the supplier endpoint with:

- Body `{ contract_id, delivery_id, bundle }`
- Headers `Idempotency-Key`, `X-HCA-Delivery-Id`, plus auth headers per mode

## C) Inbound Test (Supplier -> Proxy -> App Pull)

### 1. Send a proposal (global endpoint)

```bash
curl -i "https://care.tenos.app/sapi/v1/provider-exchange/proposals" \
  -H "Authorization: Bearer <supplier_org_token>" \
  -H "Idempotency-Key: test-$(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{
    "contract_id": "<integration_id>",
    "proposals": [
      {
        "proposal_id": "sup-001",
        "name": "Rollator",
        "category": "mobility",
        "reason": "Mobilitaetsunterstuetzung",
        "created_at": "2026-03-10T12:50:00.000Z"
      }
    ]
  }'
```

Expected:

- `200`
- `{"ok":true,"contract_id":"...","accepted":1,"deduplicated":false}`

### 2. Same request again with the same `Idempotency-Key`

Expected:

- `200`
- `{"ok":true,"accepted":0,"deduplicated":true}`

### 3. Pull via the integration

```bash
curl -i "https://care.tenos.app/sapi/v1/provider-exchange/<integration_id>/pull" \
  -H "Authorization: Bearer <integration_token>"
```

Expected:

- `200`
- `proposals[]` contains the proposal
- `cursor` is set

## D) Decision Test

```bash
curl -i "https://care.tenos.app/sapi/v1/provider-exchange/<integration_id>/proposals/sup-001/decision" \
  -H "Authorization: Bearer <integration_token>" \
  -H "Content-Type: application/json" \
  -d '{"decision":"accepted"}'
```

Expected:

- `200 {"ok":true}`
- proposal is removed from the queue

## D.1) Linking Test (app-side proxy contract)

### Direct link to a care organization

```bash
curl -i "https://care.tenos.app/sapi/v1/provider-links/care-org" \
  -H "Authorization: Bearer <app_device_jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "organization_id": "<supplier_org_id>",
    "verification_token_id": "<verification_token_id>",
    "policy": {
      "metricIds": [],
      "categories": {
        "medications": false,
        "aids": false,
        "questionnaires": false
      },
      "directions": {
        "outbound": true,
        "inbound": true
      }
    }
  }'
```

Expected:

- with a valid `verification_token_id`: `200` and `{ integration_id, token }`
- without or with a revoked token: `400` or `403`

### Accept a partner request

```bash
curl -i "https://care.tenos.app/sapi/v1/provider-links/partner-app/accept" \
  -H "Authorization: Bearer <app_device_jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "request_token": "<request_token>",
    "verification_token_id": "<verification_token_id>",
    "policy": {
      "metricIds": [],
      "categories": {
        "medications": false,
        "aids": false,
        "questionnaires": false
      },
      "directions": {
        "outbound": true,
        "inbound": true
      }
    }
  }'
```

Expected:

- with a valid `verification_token_id`: `200` and `{ integration_id, token, organization_id, organization_name }`
- with an invalid or revoked token: `403`

## E) Error Simulation for Delivery Retry

1. Deliberately set the delivery endpoint to an unreachable URL.
2. Send a push.
3. Observe in the admin status/report:
   - `retrying` and attempts increasing.
4. Fix the endpoint.
5. The job goes to `delivered` on the next retry.

## F) Replay Test

If a job is `failed_manual`:

```bash
curl -i "https://care.tenos.app/sapi/v1/admin/deliveries/<delivery_id>/replay" \
  -H "Authorization: Bearer <hca_admin_token>" \
  -X POST
```

Expected: `200 {"ok":true}` and the job is `pending` again.
