CREATE UNIQUE INDEX users_school_login_lower_key ON users (school_id, lower(login_name));
