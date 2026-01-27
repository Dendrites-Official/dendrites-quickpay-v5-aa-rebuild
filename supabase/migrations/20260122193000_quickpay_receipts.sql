-- QuickPay receipts (testnet demo). TODO: lock down with auth/RLS policies.
create table if not exists public.quickpay_receipts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  chain_id int not null,
  receipt_id text not null,
  userop_hash text,
  tx_hash text,
  status text not null,
  success boolean,
  lane text,
  fee_mode text,
  fee_token_mode text,
  token text,
  "to" text,
  sender text,
  net_amount_raw text,
  fee_amount_raw text,
  amount_raw text,
  fee_vault text,
  title text,
  note text,
  reference_id text,
  token_symbol text,
  token_decimals int,
  raw jsonb,
  unique (chain_id, receipt_id),
  unique (chain_id, userop_hash),
  unique (chain_id, tx_hash)
);

alter table public.quickpay_receipts enable row level security;

-- Public read/write for testnet only. TODO: restrict by auth when available.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'quickpay_receipts'
      and policyname = 'quickpay_receipts_select_public'
  ) then
    create policy "quickpay_receipts_select_public"
      on public.quickpay_receipts
      for select
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'quickpay_receipts'
      and policyname = 'quickpay_receipts_insert_public'
  ) then
    create policy "quickpay_receipts_insert_public"
      on public.quickpay_receipts
      for insert
      with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'quickpay_receipts'
      and policyname = 'quickpay_receipts_update_public'
  ) then
    create policy "quickpay_receipts_update_public"
      on public.quickpay_receipts
      for update
      using (true);
  end if;
end $$;
