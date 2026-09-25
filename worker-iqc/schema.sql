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
