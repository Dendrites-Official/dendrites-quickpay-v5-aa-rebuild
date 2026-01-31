alter table if exists public.ack_links
  add column if not exists receipt_id text null;

create index if not exists ack_links_receipt_id_idx on public.ack_links (receipt_id);
