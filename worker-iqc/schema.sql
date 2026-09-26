-- IQC data for the IQC HIV Viral Load page (IQC/IQC_HIV_VL_Generator.html).
-- Dates are stored as YYYY-MM-DD; values are log10 copies/mL rounded to 4 decimals,
-- which makes re-uploading the same export a no-op via the UNIQUE constraint.
CREATE TABLE IF NOT EXISTS iqc_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_code    TEXT NOT NULL,
  assay       TEXT NOT NULL,
  level       TEXT NOT NULL,
  reagent_lot TEXT NOT NULL,
  control_lot TEXT NOT NULL DEFAULT '',
  run_date    TEXT NOT NULL,
  value       REAL NOT NULL,
  source_file TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (lab_code, assay, level, reagent_lot, control_lot, run_date, value)
);

-- Latest QCloud peer-group statistics per lot; an older report never overwrites a newer one.
CREATE TABLE IF NOT EXISTS iqc_peer (
  lab_code    TEXT NOT NULL,
  assay       TEXT NOT NULL,
  level       TEXT NOT NULL,
  reagent_lot TEXT NOT NULL,
  control_lot TEXT NOT NULL DEFAULT '',
  peer_mean   REAL NOT NULL,
  peer_sd     REAL NOT NULL,
  peer_cv     REAL,
  peer_n      INTEGER,
  report_date TEXT NOT NULL,
  source_file TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (lab_code, assay, level, reagent_lot, control_lot)
);

-- Latest "Peer Comparison" sheet (every lab in the peer group), stored as JSON rows.
CREATE TABLE IF NOT EXISTS iqc_benchmark (
  lab_code    TEXT NOT NULL,
  assay       TEXT NOT NULL,
  rows        TEXT NOT NULL,
  report_date TEXT NOT NULL,
  source_file TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (lab_code, assay)
);

-- EQA rounds for EQA_Summary.html — one row per programme / provider / year / round.
-- program: CD4 | HIVVL | HPV | COVID; result: PASS | FAIL | PENDING (submitted, not yet evaluated).
-- The original PDF report is stored in the EQA_PDF KV namespace under key "pdf:<id>".
CREATE TABLE IF NOT EXISTS eqa_rounds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  program     TEXT NOT NULL,
  provider    TEXT NOT NULL,
  year_be     INTEGER NOT NULL,
  round       TEXT NOT NULL,
  report_date TEXT,
  lab_id      TEXT,
  score       REAL,
  max_score   REAL,
  grade       TEXT,
  result      TEXT NOT NULL,
  details     TEXT,
  note        TEXT,
  pdf_name    TEXT,
  pdf_size    INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (program, provider, year_be, round)
);

-- Yearly documents per programme for EQA_Summary.html: certificates (doc_type 'cert') and
-- full/annual reports ('report'). Several per programme-year (e.g. a สวส. and a QCMD certificate).
-- The file itself (PDF / PNG / JPG) is in the EQA_PDF KV namespace under key "doc:<id>".
CREATE TABLE IF NOT EXISTS eqa_docs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  program      TEXT NOT NULL,
  year_be      INTEGER NOT NULL,
  doc_type     TEXT NOT NULL,
  provider     TEXT,
  file_name    TEXT NOT NULL,
  file_size    INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eqa_docs_year ON eqa_docs (program, year_be);
