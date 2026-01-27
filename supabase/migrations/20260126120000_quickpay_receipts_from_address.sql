-- Backfill/compat for legacy clients expecting from_address
alter table public.quickpay_receipts
  add column if not exists from_address text;

update public.quickpay_receipts
set from_address = coalesce(from_address, owner_eoa, sender)
where from_address is null;
