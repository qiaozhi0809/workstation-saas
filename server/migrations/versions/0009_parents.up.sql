-- parent_links:只读 / 归档状态。新增列都有默认值,旧数据全部是 active。
ALTER TABLE parent_links
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','readonly','ended')),
  ADD COLUMN readonly_since timestamptz,
  ADD COLUMN ended_at timestamptz,
  ADD COLUMN created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT parent_links_readonly_since_ck
    CHECK ((status = 'readonly') = (readonly_since IS NOT NULL)),
  ADD CONSTRAINT parent_links_ended_at_ck
    CHECK ((status = 'ended') = (ended_at IS NOT NULL));

-- 主家长唯一索引放宽为"未结束"的才算。旧索引 WHERE is_primary 是新索引的更严格版本:
-- 旧数据满足旧索引就必然满足新索引(且此时所有行都是 active),所以重建不会冲突,无需预检查重。
DROP INDEX IF EXISTS parent_links_one_primary;
CREATE UNIQUE INDEX parent_links_one_primary
  ON parent_links (student_id) WHERE is_primary AND status <> 'ended';

-- 家长首页:按家长找未结束的绑定
CREATE INDEX parent_links_parent ON parent_links (parent_id) WHERE status <> 'ended';

-- comments:家长是否可见。AI 生成的评语默认不可见(老师审阅后再共享),其余默认可见。
ALTER TABLE comments ADD COLUMN parent_visible boolean NOT NULL DEFAULT true;
UPDATE comments SET parent_visible = NOT generated_by_ai;
