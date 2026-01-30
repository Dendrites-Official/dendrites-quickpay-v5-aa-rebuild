-- qp_requests: one row per API/Edge request
create table if not exists public.qp_requests (
  id bigserial primary key,
  ts timestamptz not null default now(),
  req_id text not null,
  source text not null,
  route text not null,
  ok boolean not null,
  status_code int not null,
  latency_ms int not null,
  error_code text null,
  ip_hash text null,
  wallet text null,
  token text null,
  speed text null,
  lane text null,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists qp_requests_ts_idx on public.qp_requests (ts desc);
create index if not exists qp_requests_route_ts_idx on public.qp_requests (route, ts desc);
create index if not exists qp_requests_wallet_ts_idx on public.qp_requests (wallet, ts desc);
create index if not exists qp_requests_ok_ts_idx on public.qp_requests (ok, ts desc);
create index if not exists qp_requests_error_ts_idx on public.qp_requests (error_code, ts desc);

-- qp_errors: only failures with extra context (redacted)
create table if not exists public.qp_errors (
  id bigserial primary key,
  ts timestamptz not null default now(),
  req_id text not null,
  source text not null,
  route text not null,
  error_code text not null,
  message_redacted text null,
  stack_redacted text null,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists qp_errors_ts_idx on public.qp_errors (ts desc);
create index if not exists qp_errors_code_ts_idx on public.qp_errors (error_code, ts desc);

-- qp_chain_snapshots: periodic chain health (for paymaster + FeeVault)
create table if not exists public.qp_chain_snapshots (
  id bigserial primary key,
  ts timestamptz not null default now(),
  chain_id int not null,
  rpc_ok boolean not null,
  bundler_ok boolean not null,
  paymaster_deposit_wei text null,
  fee_vault_balances jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists qp_chain_snapshots_ts_idx on public.qp_chain_snapshots (ts desc);
