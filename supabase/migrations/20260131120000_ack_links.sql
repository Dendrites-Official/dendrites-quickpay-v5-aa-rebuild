create table if not exists public.ack_links (
  id uuid primary key default gen_random_uuid(),
  link_id text not null unique,
  sender text not null,
  token text not null,
  amount_usdc6 numeric not null,
  fee_usdc6 numeric not null,
  speed text not null,
  status text not null,
  expires_at timestamptz not null,
  meta jsonb null,
  tx_hash_create text null,
  user_op_hash_create text null,
  tx_hash_claim text null,
  user_op_hash_claim text null,
  claimed_to text null,
  tx_hash_refund text null,
  user_op_hash_refund text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ack_links_sender_idx on public.ack_links (sender);
create index if not exists ack_links_expires_idx on public.ack_links (expires_at);
create index if not exists ack_links_status_idx on public.ack_links (status);
