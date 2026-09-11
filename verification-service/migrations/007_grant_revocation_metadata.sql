-- Track who ended a project grant.
--
-- 'clinician'          — revoked by clinic staff in the Clinic Portal
-- 'patient_withdrawal' — the patient withdrew from the project in the app
--                        (consent withdrawal, GDPR Art. 7(3))

ALTER TABLE project_grants ADD COLUMN IF NOT EXISTS revoked_reason VARCHAR(50);
