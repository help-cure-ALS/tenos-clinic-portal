CREATE TABLE IF NOT EXISTS app_devices (
    device_id VARCHAR(255) PRIMARY KEY,
    public_key BYTEA NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    token_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ,
    disabled_at TIMESTAMPTZ
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'app_devices_status_check'
    ) THEN
        ALTER TABLE app_devices
            ADD CONSTRAINT app_devices_status_check
            CHECK (status IN ('active', 'disabled'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_auth_challenges (
    challenge_id UUID PRIMARY KEY,
    device_id VARCHAR(255) NOT NULL REFERENCES app_devices(device_id) ON DELETE CASCADE,
    challenge BYTEA NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_auth_challenges_device
    ON app_auth_challenges(device_id);

CREATE INDEX IF NOT EXISTS idx_app_auth_challenges_expires
    ON app_auth_challenges(expires_at);
