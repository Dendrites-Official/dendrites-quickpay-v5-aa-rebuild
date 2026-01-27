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

create index if not exists faucet_claims_kind_created_at_idx on public.faucet_claims (kind, created_at desc);
create index if not exists faucet_claims_address_created_at_idx on public.faucet_claims (address, created_at desc);
create index if not exists faucet_claims_email_created_at_idx on public.faucet_claims (email, created_at desc);
create index if not exists faucet_claims_ip_created_at_idx on public.faucet_claims (ip_hash, created_at desc);
