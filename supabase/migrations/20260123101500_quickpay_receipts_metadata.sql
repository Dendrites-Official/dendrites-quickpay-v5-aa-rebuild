-- Extend quickpay_receipts metadata (testnet demo). TODO: lock down with auth/RLS policies.
alter table public.quickpay_receipts
  add column if not exists display_name text,
  add column if not exists reason text,
  add column if not exists note text,
  add column if not exists created_by text,
  add column if not exists reference_id text;
