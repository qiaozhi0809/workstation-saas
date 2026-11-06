DROP TABLE IF EXISTS login_logs;
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_totp_pair_ck,
  DROP COLUMN IF EXISTS totp_enabled_at,
  DROP COLUMN IF EXISTS totp_secret,
  DROP COLUMN IF EXISTS password_changed_at;
