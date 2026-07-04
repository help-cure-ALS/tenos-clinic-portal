ALTER TABLE supplier_integrations
    ADD COLUMN IF NOT EXISTS verification_token_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS verification_clinic_pseudonym VARCHAR(255),
    ADD COLUMN IF NOT EXISTS verification_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_supplier_integrations_verification_token_id
    ON supplier_integrations(verification_token_id);
