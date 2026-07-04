ALTER TABLE supplier_integrations
    ADD COLUMN IF NOT EXISTS country_code VARCHAR(3),
    ADD COLUMN IF NOT EXISTS status_reason TEXT,
    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_supplier_check_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'supplier_integrations_status_check'
    ) THEN
        ALTER TABLE supplier_integrations
            ADD CONSTRAINT supplier_integrations_status_check
            CHECK (status IN (
                'active',
                'paused_by_patient',
                'supplier_disabled',
                'supplier_deleted',
                'revoked'
            ));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_integrations_status ON supplier_integrations(status);
CREATE INDEX IF NOT EXISTS idx_supplier_integrations_country ON supplier_integrations(country_code);

CREATE TABLE IF NOT EXISTS supplier_aid_states (
    integration_id UUID NOT NULL REFERENCES supplier_integrations(integration_id) ON DELETE CASCADE,
    aid_id VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (integration_id, aid_id)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'supplier_aid_states_status_check'
    ) THEN
        ALTER TABLE supplier_aid_states
            ADD CONSTRAINT supplier_aid_states_status_check
            CHECK (status IN ('none', 'suggested', 'requested', 'approved', 'rejected'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_aid_states_updated_at ON supplier_aid_states(updated_at);
