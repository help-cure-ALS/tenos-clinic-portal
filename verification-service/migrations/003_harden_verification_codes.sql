-- Harden verification code handling:
-- 1) Normalize stale pending rows
-- 2) De-duplicate pending codes per clinic
-- 3) Enforce uniqueness for new pending rows

-- Expire stale pending requests first.
UPDATE verification_requests
SET status = 'expired',
    resolved_at = COALESCE(resolved_at, now())
WHERE status = 'pending'
  AND expires_at < now();

-- Keep only the most recent pending request per (clinic_id, code).
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY clinic_id, code
               ORDER BY created_at DESC, id DESC
           ) AS rn
    FROM verification_requests
    WHERE status = 'pending'
)
UPDATE verification_requests vr
SET status = 'expired',
    resolved_at = COALESCE(vr.resolved_at, now())
FROM ranked r
WHERE vr.id = r.id
  AND r.rn > 1;

-- Enforce deterministic lookup for clinic-scoped confirms/rejects.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vr_pending_clinic_code
    ON verification_requests (clinic_id, code)
    WHERE status = 'pending';
