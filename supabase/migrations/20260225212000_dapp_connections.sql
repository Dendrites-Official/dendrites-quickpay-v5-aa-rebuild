-- Dapp connection tracking
create table if not exists public.dapp_connections (
  id uuid primary key default gen_random_uuid(),
  wallet text,
  session_id text,
  user_agent text,
  geo_country text,
  geo_region text,
  geo_city text,
  geo_lat numeric,
  geo_lon numeric,
  connected_at timestamptz not null default now()
);

create index if not exists dapp_connections_connected_at_idx
  on public.dapp_connections (connected_at desc);

create index if not exists dapp_connections_wallet_idx
  on public.dapp_connections (wallet);

alter table public.dapp_connections enable row level security;

create policy "dapp_connections_insert_anon"
  on public.dapp_connections
  for insert
  to anon
  with check (true);

create policy "dapp_connections_select_anon"
  on public.dapp_connections
  for select
  to anon
  using (true);
