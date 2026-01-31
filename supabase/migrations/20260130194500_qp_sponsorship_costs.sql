-- Idempotent sponsorship cost tracking schema

create extension if not exists pgcrypto;

create table if not exists public.qp_sponsorship_costs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  chain_id int,
  route text,
  req_id text,
  tx_hash text,
  user_op_hash text,
  gas_used numeric,
  effective_gas_price_wei numeric,
  eth_cost_wei numeric,
  meta jsonb
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'qp_sponsorship_costs'
      and column_name = 'userop_hash'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'qp_sponsorship_costs'
      and column_name = 'user_op_hash'
  ) then
    alter table public.qp_sponsorship_costs rename column userop_hash to user_op_hash;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'qp_sponsorship_costs'
      and column_name = 'effective_gas_price'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'qp_sponsorship_costs'
      and column_name = 'effective_gas_price_wei'
  ) then
    alter table public.qp_sponsorship_costs rename column effective_gas_price to effective_gas_price_wei;
  end if;
end $$;

alter table public.qp_sponsorship_costs
  add column if not exists chain_id int,
  add column if not exists route text,
  add column if not exists req_id text,
  add column if not exists tx_hash text,
  add column if not exists user_op_hash text,
  add column if not exists gas_used numeric,
  add column if not exists effective_gas_price_wei numeric,
  add column if not exists eth_cost_wei numeric,
  add column if not exists meta jsonb,
  add column if not exists created_at timestamptz;

-- add unique constraint on tx_hash if missing
DO $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema = kcu.table_schema
    where tc.table_schema = 'public'
      and tc.table_name = 'qp_sponsorship_costs'
      and tc.constraint_type = 'UNIQUE'
      and kcu.column_name = 'tx_hash'
  ) then
    alter table public.qp_sponsorship_costs
      add constraint qp_sponsorship_costs_tx_hash_unique unique (tx_hash);
  end if;
end $$;

create index if not exists qp_sponsorship_costs_created_at_idx
  on public.qp_sponsorship_costs (created_at);

create index if not exists qp_sponsorship_costs_route_idx
  on public.qp_sponsorship_costs (route);

create index if not exists qp_sponsorship_costs_user_op_hash_idx
  on public.qp_sponsorship_costs (user_op_hash);
