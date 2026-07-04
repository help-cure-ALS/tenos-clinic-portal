# Security Policy

The TENOS Care-Backend handles medical and health-related data for people with ALS. Please report suspected vulnerabilities privately.

## Reporting a Vulnerability

Do not open a public GitHub issue for security vulnerabilities.

Use GitHub private vulnerability reporting if it is enabled for this repository. If it is not enabled, contact the maintainers through the project's private communication channel.

When reporting, include:

- A concise description of the issue.
- Affected endpoint, service, or configuration.
- Reproduction steps.
- Impact assessment.
- Suggested mitigation, if known.

Do not include real patient data, medical payloads, verification codes, private keys, JWTs, service tokens, client secrets, or production secrets in the report.

## Security Scope

In scope:

- Authentication and authorization bypasses in any service (Medplum access policies, verification-service, supplier-proxy, studies-sync, clinician portal).
- Verification-code or invitation-token bypasses (guessing, replay, expiry bypass).
- Cross-clinic data access — one clinic reading or modifying another clinic's resources.
- Leakage of patient identifiers, pseudonyms, diagnosis data, keys, JWTs, or supplier payloads.
- Supplier payload encryption weaknesses or key-handling flaws.
- Unsafe logging or error responses.
- Deployment configuration that could expose secrets or plaintext.

Out of scope:

- Mobile app behavior outside this repository.
- Vulnerabilities that require access to a compromised client device and do not change server-side guarantees.
- Denial-of-service reports without a practical mitigation path.

## Design Expectations

- Clinic data access is always scoped by Medplum access policies; no service may bypass them.
- Verification codes are short-lived, single-use, and rate-limited.
- Supplier payloads are encrypted at rest (AES-256, versioned keys); keys live only in environment configuration.
- Service-to-service calls require service tokens; app-facing routes require signed JWTs with issuer and audience checks.
- Admin endpoints are restricted to `hca-admin` and expose no patient-level data beyond operational need.
