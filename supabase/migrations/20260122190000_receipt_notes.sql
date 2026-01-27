-- Receipt notes metadata (testnet only). TODO: lock down with auth/RLS policies.
create table if not exists public.receipt_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_wallet text not null,
  chain_id int not null default 84532,
  userop_hash text,
  tx_hash text,
  title text,
  note text,
  reference_id text,
  to_address text,
  token_address text,
  amount_raw text,
  unique (chain_id, userop_hash),
  unique (chain_id, tx_hash)
);

alter table public.receipt_notes enable row level security;

-- Public read/write for testnet only. TODO: restrict by auth when available.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'receipt_notes'
      and policyname = 'receipt_notes_select_public'
  ) then
    create policy "receipt_notes_select_public"
      on public.receipt_notes
      for select
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'receipt_notes'
      and policyname = 'receipt_notes_insert_public'
  ) then
    create policy "receipt_notes_insert_public"
      on public.receipt_notes
      for insert
      with check (true);
  end if;
end $$;
