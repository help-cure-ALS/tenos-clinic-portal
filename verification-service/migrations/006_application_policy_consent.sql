-- Privacy policy consent proof on project applications and grants.
--
-- accepted_policy_version: the project's privacy_policy_version shown to the
-- patient at application time (language-independent content version).
-- accepted_locale: the language the policy was displayed in.

ALTER TABLE project_applications
    ADD COLUMN IF NOT EXISTS accepted_policy_version INTEGER;

ALTER TABLE project_applications
    ADD COLUMN IF NOT EXISTS accepted_locale VARCHAR(10);

ALTER TABLE project_grants
    ADD COLUMN IF NOT EXISTS accepted_policy_version INTEGER;

ALTER TABLE project_grants
    ADD COLUMN IF NOT EXISTS accepted_locale VARCHAR(10);
