-- Run this SQL in the Supabase SQL Editor for project adtjorcpqpmqvhostkbg.
-- RLS is enabled so the service-role key can be used only by the Worker.
create extension if not exists pgcrypto;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('week', 'month')),
  anchor_date date not null,
  period_start date not null,
  period_end date not null,
  title text not null,
  snapshot jsonb not null default '{}'::jsonb,
  review jsonb not null default '[]'::jsonb,
  evaluations jsonb not null default '[]'::jsonb,
  work_items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(kind, period_start)
);

create index if not exists reports_period_idx on public.reports(kind, period_start desc);
alter table public.reports enable row level security;

comment on table public.reports is 'Immutable-by-period weekly/monthly report snapshots and editable work plans for Report ALF.';
