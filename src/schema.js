// Esquema do MariaDB (compatível com 10.3+). Usado pelo app na inicialização e pelo script de migração do SQLite.
// IDs e textos usam utf8mb4_bin (comparação exata, como no SQLite); usuário, email e nome da jornada usam
// utf8mb4_unicode_ci para ficarem únicos sem diferenciar maiúsculas e minúsculas.
const TABLE = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';
const CI = 'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci';

export const TABLES = [
  ['users', `CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) NOT NULL,
  username VARCHAR(64) ${CI} NOT NULL,
  email VARCHAR(254) ${CI} NULL,
  role VARCHAR(32) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_username_unique (username),
  UNIQUE KEY users_email_unique (email)
) ${TABLE}`],
  ['user_sessions', `CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash CHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token_hash),
  KEY user_sessions_expiry_idx (expires_at),
  CONSTRAINT user_sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ${TABLE}`],
  ['password_reset_codes', `CREATE TABLE IF NOT EXISTS password_reset_codes (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at BIGINT NOT NULL,
  used TINYINT(1) NOT NULL DEFAULT 0 CHECK (used IN (0,1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY password_reset_expiry_idx (expires_at),
  CONSTRAINT password_reset_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ${TABLE}`],
  ['user_onboarding', `CREATE TABLE IF NOT EXISTS user_onboarding (
  user_id VARCHAR(64) NOT NULL,
  complete TINYINT(1) NOT NULL DEFAULT 0 CHECK (complete IN (0,1)),
  completed_at DATETIME NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT user_onboarding_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ${TABLE}`],
  ['work_schedules', `CREATE TABLE IF NOT EXISTS work_schedules (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(100) ${CI} NOT NULL,
  created_by VARCHAR(64) NULL,
  is_builtin TINYINT(1) NOT NULL DEFAULT 0 CHECK (is_builtin IN (0,1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY work_schedules_name_unique (name),
  CONSTRAINT work_schedules_creator_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ${TABLE}`],
  ['work_schedule_days', `CREATE TABLE IF NOT EXISTS work_schedule_days (
  schedule_id VARCHAR(64) NOT NULL,
  weekday TINYINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute SMALLINT NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute SMALLINT NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  break_minutes SMALLINT NOT NULL CHECK (break_minutes BETWEEN 0 AND 240),
  frequency VARCHAR(16) NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('weekly','biweekly')),
  anchor_date DATE NULL,
  PRIMARY KEY (schedule_id, weekday),
  CONSTRAINT work_schedule_days_schedule_fk FOREIGN KEY (schedule_id) REFERENCES work_schedules(id) ON DELETE CASCADE,
  CONSTRAINT work_schedule_days_range CHECK (end_minute > start_minute),
  CONSTRAINT work_schedule_days_break CHECK (break_minutes < end_minute - start_minute),
  CONSTRAINT work_schedule_days_anchor CHECK ((frequency = 'weekly' AND anchor_date IS NULL) OR (frequency = 'biweekly' AND anchor_date IS NOT NULL))
) ${TABLE}`],
  ['user_work_schedules', `CREATE TABLE IF NOT EXISTS user_work_schedules (
  user_id VARCHAR(64) NOT NULL,
  schedule_id VARCHAR(64) NOT NULL,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT user_work_schedules_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_work_schedules_schedule_fk FOREIGN KEY (schedule_id) REFERENCES work_schedules(id)
) ${TABLE}`],
  ['marks', `CREATE TABLE IF NOT EXISTS marks (
  user_id VARCHAR(64) NOT NULL,
  id VARCHAR(128) NOT NULL,
  mark_datetime DATETIME NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
  origin VARCHAR(32) NOT NULL DEFAULT 'import',
  PRIMARY KEY (user_id, id),
  KEY user_marks_datetime_idx (user_id, mark_datetime),
  CONSTRAINT marks_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ${TABLE}`],
  ['day_settings', `CREATE TABLE IF NOT EXISTS day_settings (
  user_id VARCHAR(64) NOT NULL,
  date DATE NOT NULL,
  target_minutes SMALLINT NOT NULL,
  note VARCHAR(255) NOT NULL DEFAULT '',
  kind VARCHAR(32) NOT NULL DEFAULT 'adjustment' CHECK (kind IN ('adjustment','compensatory-off')),
  PRIMARY KEY (user_id, date),
  CONSTRAINT day_settings_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ${TABLE}`],
  ['user_settings', `CREATE TABLE IF NOT EXISTS user_settings (
  user_id VARCHAR(64) NOT NULL,
  \`key\` VARCHAR(64) NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, \`key\`),
  CONSTRAINT user_settings_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ${TABLE}`],
  ['shift_provisions', `CREATE TABLE IF NOT EXISTS shift_provisions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(64) NOT NULL,
  duty_date DATE NOT NULL,
  day_off_date DATE NOT NULL,
  duty_target_minutes SMALLINT NOT NULL CHECK (duty_target_minutes IN (480, 540)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY shift_provisions_duty_unique (user_id, duty_date),
  UNIQUE KEY shift_provisions_day_off_unique (user_id, day_off_date),
  CONSTRAINT shift_provisions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ${TABLE}`],
];
