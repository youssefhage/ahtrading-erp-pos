-- User profile fields + MFA support (TOTP).

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivation_reason text,
  ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_secret_enc text,
  ADD COLUMN IF NOT EXISTS mfa_pending_secret_enc text,
  ADD COLUMN IF NOT EXISTS mfa_verified_at timestamptz;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS chk_users_mfa_enabled_has_secret;
ALTER TABLE users
  ADD CONSTRAINT chk_users_mfa_enabled_has_secret
  CHECK (mfa_enabled = false OR mfa_secret_enc IS NOT NULL);

-- MFA challenges are short-lived tokens created during login for users with MFA enabled.
CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_expires
  ON auth_mfa_challenges(expires_at DESC)
  WHERE consumed_at IS NULL;

COMMIT;

