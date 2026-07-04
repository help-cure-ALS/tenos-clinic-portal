# 07 - Operations Runbook

This chapter is aimed at operations/support (`hca-admin`, DevOps).

## 1. Activate/Deactivate a Supplier in Medplum

Supplier integrations only work if the `Organization`:

- exists
- `active = true`
- has the tag `urn:hca:supplier|enabled` set
- has `address[0].country` set

If these conditions are not met, the proxy blocks fail-closed:

- integration auth -> `integration_inactive`
- supplier auth -> `supplier_inactive`

## 2. Manage Supplier API Tokens (global inbound)

Admin routes:

- `GET /v1/admin/suppliers/:organizationId/auth-token`
- `POST /v1/admin/suppliers/:organizationId/auth-token/rotate`
- `POST /v1/admin/suppliers/:organizationId/auth-token/revoke`

In practice:

1. Only view the token on rotate and hand it over securely.
2. On a leak, revoke + rotate immediately.

## 3. Manage Integrations

Admin routes:

- `GET /v1/admin/suppliers/:organizationId/integrations`
- `POST /v1/admin/suppliers/:organizationId/integrations`
- `POST /v1/admin/integrations/:integrationId/rotate-token`
- `POST /v1/admin/integrations/:integrationId/revoke`

Note:

- App disconnect (`/v1/provider-exchange/:id/disconnect`) sets the integration to `revoked`.
- Open delivery jobs of this integration are set to `failed_manual`.

## 4. Operate the Delivery Config

Admin routes:

- `GET /v1/admin/suppliers/:organizationId/delivery-config`
- `PUT /v1/admin/suppliers/:organizationId/delivery-config`
- `POST /v1/admin/suppliers/:organizationId/delivery-test`

Configuration fields:

- `endpoint_url`
- `auth_mode` (`bearer` or `hmac`)
- `auth_secret` (only on create/update)
- `enabled`
- `timeout_ms` (1000..120000)

## 5. Delivery Monitoring and Replay

Admin routes:

- `GET /v1/admin/suppliers/:organizationId/delivery-status`
- `GET /v1/admin/suppliers/:organizationId/delivery-attempts?limit=50`
- `POST /v1/admin/deliveries/:deliveryId/replay`

Interpretation:

- `healthy`: no open/failed jobs
- `retrying`: open jobs or retry in progress
- `failed_manual`: at least one job needs manual intervention

Replay is only allowed for `failed_manual`.

## 6. Workflow Policies (global per country)

Admin routes:

- `GET /v1/admin/workflow-policy?country=DE`
- `POST /v1/admin/workflow-policy`
- `GET /v1/admin/workflow-policies`

The policy takes effect on:

- `POST /v1/provider-exchange/:id/transitions`

## 7. Payload Key Rotation (at-rest encryption)

Key envs:

- `SUPPLIER_PAYLOAD_KEYS_JSON` (map version -> base64 key, 32-byte AES key)
- `SUPPLIER_PAYLOAD_ACTIVE_KEY_VERSION` (active write key)

Recommended procedure:

1. Add the new key version to `SUPPLIER_PAYLOAD_KEYS_JSON`.
2. Set `SUPPLIER_PAYLOAD_ACTIVE_KEY_VERSION` to the new version.
3. Restart the service.
4. Keep old versions for reading until no old payloads are needed anymore.

Fail-fast:

- An invalid key config stops the service at startup (`supplier-crypto:*`).

## 8. Audit and Troubleshooting

- Sensitive actions are written to `supplier_audit_log`.
- Delivery error details are stored in:
  - `supplier_delivery_jobs.last_error_*`
  - `supplier_delivery_attempts`

Typical causes:

- wrong supplier auth secret
- endpoint down/timeout
- invalid supplier organization in Medplum (inactive/tag removed)
