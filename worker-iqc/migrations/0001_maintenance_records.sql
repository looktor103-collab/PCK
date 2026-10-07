CREATE TABLE IF NOT EXISTS maintenance_records (
  form_id    TEXT NOT NULL,
  record_key TEXT NOT NULL,
  data_json  TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (form_id, record_key)
);