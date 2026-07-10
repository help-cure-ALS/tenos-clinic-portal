# Contributing

Thank you for helping improve the TENOS Clinic Backend.

## Ground Rules

- Never commit real patient data, medical payloads, or production FHIR exports. Test with synthetic data only.
- Keep public documentation and source comments in English.
- Do not commit secrets, local `.env` files, private deployment files, database dumps, generated build output, or dependency folders.
- Keep changes small and reviewable.
- Prefer explicit security checks over implicit assumptions.
- Read `AGENTS.md` before making changes — it contains the authoritative coding workflow, architecture constraints, patterns, and anti-patterns for this codebase.

## Local Setup

```bash
cp .env.example .env
docker compose up -d
```

See the [README](./README.md#development-setup) for the full first-time Medplum setup (project, client applications, access policies, data upload).

Build the services:

```bash
cd verification-service && npm install && npm run build
cd supplier-proxy && npm install && npm run build
cd studies-sync && npm install && npm run build
cd web && npm install && npm run build
```

## Pull Request Checklist

- All touched services build (`npm run build`).
- Public docs are updated when behavior or configuration changes; the supplier contract docs in `supplier-proxy/docs/` remain the source of truth for the supplier exchange.
- New endpoints document authentication, request shape, response shape, and failure behavior.
- Logs do not include medical payloads, verification codes, private keys, JWTs, service tokens, client secrets, or payload-encryption keys.
- Database changes are represented as migrations.
- New environment variables are added to `.env.example` with a comment and a safe placeholder value.

## Documentation Style

Use consistent terms:

- `clinic`: an `Organization` resource representing an ALS clinic or care center
- `practitioner`: a `Practitioner` resource attached to a clinic
- `verification`: the device verification flow handled by `verification-service`
- `supplier`: an external partner integrated through `supplier-proxy`
- `study`: a `ResearchStudy` resource managed by `studies-sync`
- `hca-admin`: the platform-level administrator role
