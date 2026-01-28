create table if not exists public.faucet_challenges (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null,
  address text not null,
  email text not null,
  message text not null,
  ip_hash text not null
);

create index if not exists faucet_challenges_expires_at_idx on public.faucet_challenges (expires_at);
create index if not exists faucet_challenges_address_idx on public.faucet_challenges (address);
create index if not exists faucet_challenges_email_idx on public.faucet_challenges (email);

create table if not exists public.faucet_claims (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  chain_id int not null default 84532,
  kind text not null,
  address text not null,
  wallet_address text null,
  amount text null,
  email text null,
  token_address text null,
  token_amount text null,
  tx_hash text null,
  status text not null default 'submitted',
  ip_hash text not null,
  ua_hash text not null,
  error text null,
  meta jsonb not null default '{}'::jsonb,
  constraint faucet_claims_status_check check (status in ('requested','submitted','confirmed','failed'))
);

alter table if exists public.faucet_claims
  add column if not exists chain_id int,
  add column if not exists kind text,
  add column if not exists address text,
  add column if not exists wallet_address text,
  add column if not exists amount text,
  add column if not exists email text,
  add column if not exists token_address text,
  add column if not exists token_amount text,
  add column if not exists tx_hash text,
  add column if not exists status text,
  add column if not exists ip_hash text,
  add column if not exists ua_hash text,
  add column if not exists error text,
  add column if not exists meta jsonb;

do $$
begin
  if exists (select 1 from pg_type where typname = 'faucet_claim_status_type') then
    if not exists (
      select 1
      from pg_enum
      where enumlabel = 'submitted'
        and enumtypid = (select oid from pg_type where typname = 'faucet_claim_status_type')
    ) then
      alter type faucet_claim_status_type add value 'submitted';
    end if;
  end if;
end $$;

update public.faucet_claims
set
  chain_id = coalesce(chain_id, 84532),
  kind = coalesce(kind, 'mdndx'),
  wallet_address = coalesce(wallet_address, address),
  amount = coalesce(amount, token_amount),
  status = coalesce(status, 'submitted'),
  meta = coalesce(meta, '{}'::jsonb)
where chain_id is null
   or kind is null
   or status is null
   or meta is null;

alter table public.faucet_claims
  alter column chain_id set not null,
  alter column kind set not null,
  alter column address set not null,
  alter column status set not null,
  alter column ip_hash set not null,
  alter column ua_hash set not null,
  alter column meta set not null;

create index if not exists faucet_claims_kind_created_at_idx on public.faucet_claims (kind, created_at desc);
create index if not exists faucet_claims_address_created_at_idx on public.faucet_claims (address, created_at desc);
create index if not exists faucet_claims_email_created_at_idx on public.faucet_claims (email, created_at desc);
create index if not exists faucet_claims_ip_created_at_idx on public.faucet_claims (ip_hash, created_at desc);
