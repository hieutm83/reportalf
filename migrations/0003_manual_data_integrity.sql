-- Manual weekly data remains inside public.reports.snapshot/evaluations/work_items.
-- This unique index makes the period key explicit and prevents one week from overwriting another.
create unique index if not exists reports_kind_week_start_unique_idx
  on public.reports(kind, period_start);

comment on column public.reports.period_start is
  'Required week_start_date/month_start_date used by all manual-data upserts.';
