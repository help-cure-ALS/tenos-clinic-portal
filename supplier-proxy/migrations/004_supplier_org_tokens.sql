CREATE TABLE IF NOT EXISTS supplier_org_tokens (
    organization_id VARCHAR(255) PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_supplier_org_tokens_hash
    ON supplier_org_tokens(token_hash);
