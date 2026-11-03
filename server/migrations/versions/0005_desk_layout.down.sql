UPDATE enrollments SET seat_row = NULL, seat_col = NULL, seat_locked = false WHERE seat_row = 0;
ALTER TABLE seat_arrangements
  DROP COLUMN IF EXISTS podium_right,
  DROP COLUMN IF EXISTS podium_left,
  DROP COLUMN IF EXISTS desk_size;
ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS enrollments_seat_code;
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_desk_cols;
ALTER TABLE classes
  DROP COLUMN IF EXISTS room,
  DROP COLUMN IF EXISTS podium_right,
  DROP COLUMN IF EXISTS podium_left,
  DROP COLUMN IF EXISTS seat_order,
  DROP COLUMN IF EXISTS seat_layout,
  DROP COLUMN IF EXISTS desk_size;
