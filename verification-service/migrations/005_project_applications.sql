-- Research project applications and grants.
--
-- A patient applies for a closed research data collection project in the app.
-- The application follows the proven verification-code pattern:
-- 6-digit code, short TTL, clinician confirms in the Clinic Portal.
-- Confirmation creates a project grant (clinic-side source of truth).

CREATE TABLE IF NOT EXISTS project_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(6) NOT NULL,
    clinic_id VARCHAR(255) NOT NULL,
    research_project_id UUID NOT NULL,
    project_title VARCHAR(255) NOT NULL,
    verification_token_id VARCHAR(255) NOT NULL,
    anonymous_research_id UUID NOT NULL,
    share_history BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    grant_id UUID,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'project_applications_status_check'
    ) THEN
        ALTER TABLE project_applications
            ADD CONSTRAINT project_applications_status_check
            CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pa_code_status ON project_applications(code, status);
CREATE INDEX IF NOT EXISTS idx_pa_clinic ON project_applications(clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_pa_expires ON project_applications(expires_at);

-- Avoid ambiguous pending codes per clinic (same guarantee as verification_requests)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pa_pending_clinic_code
    ON project_applications(clinic_id, code)
    WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS project_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    research_project_id UUID NOT NULL,
    verification_token_id VARCHAR(255) NOT NULL,
    anonymous_research_id UUID NOT NULL,
    clinic_id VARCHAR(255) NOT NULL,
    share_history BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    granted_by VARCHAR(255),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (research_project_id, verification_token_id)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'project_grants_status_check'
    ) THEN
        ALTER TABLE project_grants
            ADD CONSTRAINT project_grants_status_check
            CHECK (status IN ('active', 'revoked', 'completed'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pg_project_token
    ON project_grants(research_project_id, verification_token_id);

CREATE INDEX IF NOT EXISTS idx_pg_clinic
    ON project_grants(clinic_id, status);
