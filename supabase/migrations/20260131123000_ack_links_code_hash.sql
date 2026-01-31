alter table if exists public.ack_links
  add column if not exists code_hash text null;

create index if not exists ack_links_code_hash_idx on public.ack_links (code_hash);
