ALTER TABLE grades
  ADD COLUMN stage text NULL CHECK (stage IN ('小学','初中','高中'));

ALTER TABLE academic_years
  ADD COLUMN term2_start date NULL
  CHECK (term2_start IS NULL OR (term2_start > start_date AND term2_start < end_date));

ALTER TABLE users
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

-- 同一学生、同一学期、内容逐字相同的评语只留最早的一条(created_at 相同取 id 最小)
DELETE FROM comments
WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (
      PARTITION BY enrollment_id, semester, md5(content)
      ORDER BY created_at, id
    ) AS rn
    FROM comments
  ) t
  WHERE rn > 1
);

CREATE UNIQUE INDEX comments_one_per_content ON comments (enrollment_id, semester, md5(content));
