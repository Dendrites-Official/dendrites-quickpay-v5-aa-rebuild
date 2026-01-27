-- Private receipt notes (sender-only). RLS enabled, no public policies.
create table if not exists public.quickpay_receipt_notes (
  chain_id int not null,
  receipt_id text not null,
  sender_address text not null,
  note text not null,
  updated_at timestamptz not null default now(),
  primary key (chain_id, receipt_id),
  foreign key (chain_id, receipt_id)
    references public.quickpay_receipts (chain_id, receipt_id)
    on delete cascade
);

alter table public.quickpay_receipt_notes enable row level security;

revoke all on table public.quickpay_receipt_notes from anon, authenticated;

-- No policies on purpose: direct access denied for anon. Use Edge Function with service role.

create index if not exists quickpay_receipt_notes_sender_idx
  on public.quickpay_receipt_notes (sender_address);
