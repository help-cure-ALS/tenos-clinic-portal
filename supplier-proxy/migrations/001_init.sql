CREATE TABLE IF NOT EXISTS supplier_integrations (
    integration_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id VARCHAR(255) NOT NULL,
    organization_name TEXT NOT NULL,
    policy JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_integration_tokens (
    integration_id UUID PRIMARY KEY REFERENCES supplier_integrations(integration_id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS supplier_link_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_token_hash CHAR(64) NOT NULL UNIQUE,
    organization_id VARCHAR(255) NOT NULL,
    organization_name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS supplier_proposals (
    id BIGSERIAL PRIMARY KEY,
    integration_id UUID NOT NULL REFERENCES supplier_integrations(integration_id) ON DELETE CASCADE,
    proposal_id VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (integration_id, proposal_id)
);

CREATE TABLE IF NOT EXISTS supplier_pushes (
    id BIGSERIAL PRIMARY KEY,
    integration_id UUID NOT NULL REFERENCES supplier_integrations(integration_id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    accepted_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_decisions (
    id BIGSERIAL PRIMARY KEY,
    integration_id UUID NOT NULL REFERENCES supplier_integrations(integration_id) ON DELETE CASCADE,
    proposal_id VARCHAR(255) NOT NULL,
    decision VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_transitions (
    id BIGSERIAL PRIMARY KEY,
    integration_id UUID NOT NULL REFERENCES supplier_integrations(integration_id) ON DELETE CASCADE,
    ticket JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_workflow_policies (
    country VARCHAR(3) PRIMARY KEY,
    policy JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_audit_log (
    id BIGSERIAL PRIMARY KEY,
    request_id VARCHAR(128),
    endpoint VARCHAR(255) NOT NULL,
    action VARCHAR(80) NOT NULL,
    integration_id UUID,
    result VARCHAR(20) NOT NULL,
    ip VARCHAR(255),
    user_agent TEXT,
    detail JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_integrations_org ON supplier_integrations(organization_id);
CREATE INDEX IF NOT EXISTS idx_supplier_link_requests_expires ON supplier_link_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_supplier_proposals_integration_id ON supplier_proposals(integration_id, id);
CREATE INDEX IF NOT EXISTS idx_supplier_pushes_integration_id ON supplier_pushes(integration_id);
CREATE INDEX IF NOT EXISTS idx_supplier_decisions_integration_id ON supplier_decisions(integration_id);
CREATE INDEX IF NOT EXISTS idx_supplier_transitions_integration_id ON supplier_transitions(integration_id);
CREATE INDEX IF NOT EXISTS idx_supplier_audit_endpoint_created ON supplier_audit_log(endpoint, created_at);

INSERT INTO supplier_workflow_policies (country, policy)
VALUES (
    'DE',
    '{
      "country": "DE",
      "transitions": [
        {"from":"suggested", "to":"requested", "allowed_roles":["patient","caregiver","doctor"]},
        {"from":"requested", "to":"approved", "allowed_roles":["patient","caregiver","doctor"]},
        {"from":"requested", "to":"rejected", "allowed_roles":["patient","caregiver","doctor"]}
      ],
      "notify_provider_on": ["approved"]
    }'::jsonb
)
ON CONFLICT (country) DO NOTHING;
