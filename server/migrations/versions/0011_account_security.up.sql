-- users:改密时间(迁移时刻起算,有默认值,PG 11+ 不重写表)、两步验证秘钥与开启时间。新列全可空或有默认值。
ALTER TABLE users
  ADD COLUMN password_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN totp_secret text,
  ADD COLUMN totp_enabled_at timestamptz,
  ADD CONSTRAINT users_totp_pair_ck CHECK ((totp_secret IS NULL) = (totp_enabled_at IS NULL));

-- 登录日志:成功与失败都记,保留期由调度任务清理
CREATE TABLE login_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  login_name text NOT NULL,
  result text NOT NULL
    CHECK (result IN ('success','bad_password','unknown_user','inactive','locked','totp_failed')),
  ip inet,
  user_agent text,
  suspicious text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_logs_school_created ON login_logs (school_id, created_at DESC);
CREATE INDEX login_logs_user_success ON login_logs (user_id, created_at DESC) WHERE result = 'success';
