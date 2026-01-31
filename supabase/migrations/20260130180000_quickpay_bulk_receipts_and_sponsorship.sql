-- Bulk receipts metadata

alter table public.quickpay_receipts
  add column if not exists meta jsonb,
  add column if not exists recipients_count int;
