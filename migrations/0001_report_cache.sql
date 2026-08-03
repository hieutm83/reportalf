-- Optional local cache for development and source snapshots.
-- Production persistence is Supabase, as requested by the report workflow.
CREATE TABLE IF NOT EXISTS report_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS report_sync_log_period_idx
  ON report_sync_log(kind, period_start, period_end);
