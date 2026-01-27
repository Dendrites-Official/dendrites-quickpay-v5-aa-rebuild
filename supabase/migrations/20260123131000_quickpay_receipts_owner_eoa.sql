-- Add owner EOA to receipts for AA identity UX
alter table public.quickpay_receipts
  add column if not exists owner_eoa text;
