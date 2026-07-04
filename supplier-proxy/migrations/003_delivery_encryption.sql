ALTER TABLE supplier_pushes
    ADD COLUMN IF NOT EXISTS payload_ciphertext BYTEA,
    ADD COLUMN IF NOT EXISTS payload_iv BYTEA,
    ADD COLUMN IF NOT EXISTS payload_auth_tag BYTEA,
    ADD COLUMN IF NOT EXISTS payload_key_version SMALLINT,
    ADD COLUMN IF NOT EXISTS payload_sha256 CHAR(64);

ALTER TABLE supplier_pushes
    DROP COLUMN IF EXISTS payload;

ALTER TABLE supplier_proposals
    ADD COLUMN IF NOT EXISTS payload_ciphertext BYTEA,
    ADD COLUMN IF NOT EXISTS payload_iv BYTEA,
    ADD COLUMN IF NOT EXISTS payload_auth_tag BYTEA,
    ADD COLUMN IF NOT EXISTS payload_key_version SMALLINT;

ALTER TABLE supplier_proposals
    DROP COLUMN IF EXISTS payload;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'supplier_pushes_payload_enc_check'
    ) THEN
        ALTER TABLE supplier_pushes
            ADD CONSTRAINT supplier_pushes_payload_enc_check CHECK (
                (payload_ciphertext IS NULL AND payload_iv IS NULL AND payload_auth_tag IS NULL AND payload_key_version IS NULL)
                OR
                (payload_ciphertext IS NOT NULL AND payload_iv IS NOT NULL AND payload_auth_tag IS NOT NULL AND payload_key_version IS NOT NULL)
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'supplier_proposals_payload_enc_check'
    ) THEN
        ALTER TABLE supplier_proposals
            ADD CONSTRAINT supplier_proposals_payload_enc_check CHECK (
                (payload_ciphertext IS NULL AND payload_iv IS NULL AND payload_auth_tag IS NULL AND payload_key_version IS NULL)
                OR
                (payload_ciphertext IS NOT NULL AND payload_iv IS NOT NULL AND payload_auth_tag IS NOT NULL AND payload_key_version IS NOT NULL)
            );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS supplier_delivery_configs (
    organization_id VARCHAR(255) PRIMARY KEY,
    endpoint_url TEXT NOT NULL,
    auth_mode VARCHAR(20) NOT NULL DEFAULT 'bearer',
    auth_secret_ciphertext BYTEA,
    auth_secret_iv BYTEA,
    auth_secret_tag BYTEA,
    auth_secret_key_version SMALLINT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    timeout_ms INTEGER NOT NULL DEFAULT 10000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'supplier_delivery_configs_auth_mode_check'
    ) THEN
        ALTER TABLE supplier_delivery_configs
            ADD CONSTRAINT supplier_delivery_configs_auth_mode_check
            CHECK (auth_mode IN ('hmac', 'bearer'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS supplier_delivery_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES supplier_integrations(integration_id) ON DELETE CASCADE,
    organization_id VARCHAR(255) NOT NULL,
    push_id BIGINT NOT NULL REFERENCES supplier_pushes(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivery_deadline_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
    first_attempt_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    last_error_code VARCHAR(80),
    last_error_message TEXT,
    last_http_status INTEGER,
    last_response_excerpt TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'supplier_delivery_jobs_status_check'
    ) THEN
        ALTER TABLE supplier_delivery_jobs
            ADD CONSTRAINT supplier_delivery_jobs_status_check
            CHECK (status IN ('pending', 'retrying', 'delivered', 'failed_manual'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_delivery_jobs_due
    ON supplier_delivery_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_supplier_delivery_jobs_org
    ON supplier_delivery_jobs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_delivery_jobs_integration
    ON supplier_delivery_jobs(integration_id, created_at DESC);

CREATE TABLE IF NOT EXISTS supplier_delivery_attempts (
    id BIGSERIAL PRIMARY KEY,
    delivery_id UUID NOT NULL REFERENCES supplier_delivery_jobs(id) ON DELETE CASCADE,
    attempt_no INTEGER NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    success BOOLEAN NOT NULL DEFAULT false,
    http_status INTEGER,
    error_code VARCHAR(80),
    error_message TEXT,
    response_excerpt TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_delivery_attempts_delivery
    ON supplier_delivery_attempts(delivery_id, created_at DESC);

CREATE TABLE IF NOT EXISTS supplier_inbound_idempotency (
    integration_id UUID NOT NULL REFERENCES supplier_integrations(integration_id) ON DELETE CASCADE,
    endpoint VARCHAR(255) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (integration_id, endpoint, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_supplier_inbound_idempotency_expires
    ON supplier_inbound_idempotency(expires_at);
