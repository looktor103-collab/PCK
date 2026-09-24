-- Inventory data, stored one row per "tab" (ITEMS, TXN, BILLS, SUPPLIERS,
-- PO_HEADERS, PO_ITEMS, PO_RECEIPTS, overview, JAN..DEC).
-- `data` is the full JSON array of row objects for that tab — mirrors the
-- shape inventory.html already works with (getData(tab) / writeTab(tab, rows)),
-- so no client-side data-model changes are needed, only the sync URL.
CREATE TABLE IF NOT EXISTS tabs (
  tab        TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
