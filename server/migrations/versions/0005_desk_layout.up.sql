ALTER TABLE classes
  ADD COLUMN desk_size int NOT NULL DEFAULT 2 CHECK (desk_size IN (1,2,3)),
  ADD COLUMN seat_layout text NOT NULL DEFAULT 'auto' CHECK (seat_layout IN ('auto','manual')),
  ADD COLUMN seat_order text NOT NULL DEFAULT 'row' CHECK (seat_order IN ('row','col')),
  ADD COLUMN podium_left int NOT NULL DEFAULT 0 CHECK (podium_left BETWEEN 0 AND 2),
  ADD COLUMN podium_right int NOT NULL DEFAULT 0 CHECK (podium_right BETWEEN 0 AND 2),
  ADD COLUMN room text NOT NULL DEFAULT '' CHECK (char_length(room) <= 30);

-- 已有班级:自己设定、双人同桌;奇数列加 1(只在最右多一列空座,座位不动)
UPDATE classes SET seat_layout = 'manual', seat_cols = seat_cols + (seat_cols % 2);

ALTER TABLE classes
  ADD CONSTRAINT classes_desk_cols CHECK (seat_cols % desk_size = 0);

-- 讲台边座位:第 0 排,列 -2/-1(左)、1/2(右)
ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_seat_code
  CHECK (seat_row IS NULL OR seat_row >= 1 OR (seat_row = 0 AND seat_col IN (-2,-1,1,2)));

ALTER TABLE seat_arrangements
  ADD COLUMN desk_size int NOT NULL DEFAULT 2,
  ADD COLUMN podium_left int NOT NULL DEFAULT 0,
  ADD COLUMN podium_right int NOT NULL DEFAULT 0;
