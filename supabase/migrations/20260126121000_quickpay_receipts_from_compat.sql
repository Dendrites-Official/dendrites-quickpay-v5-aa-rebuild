-- Compatibility column for clients requesting "from"
alter table public.quickpay_receipts
  add column if not exists "from" text;

update public.quickpay_receipts
set "from" = coalesce("from", owner_eoa, sender, from_address)
where "from" is null;
