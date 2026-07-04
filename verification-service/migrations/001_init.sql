-- Verification requests (short-lived, 2 min TTL)
CREATE TABLE IF NOT EXISTS verification_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(6) NOT NULL,
    clinic_id VARCHAR(255) NOT NULL,
    device_id VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    token_id VARCHAR(255),
    clinic_pseudonym VARCHAR(255),
    diagnosis_system VARCHAR(255),
    diagnosis_code VARCHAR(20),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vr_code_status ON verification_requests(code, status);
CREATE INDEX IF NOT EXISTS idx_vr_clinic ON verification_requests(clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_vr_expires ON verification_requests(expires_at);
