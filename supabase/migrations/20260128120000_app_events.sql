create extension if not exists "pgcrypto";

create table if not exists public.app_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null,
  address text null,
  chain_id int null,
  meta jsonb null,
  ip_hash text null,
  ua_hash text null
);

create index if not exists app_events_created_at_idx on public.app_events (created_at desc);
create index if not exists app_events_kind_idx on public.app_events (kind);
create index if not exists app_events_address_idx on public.app_events (address);
