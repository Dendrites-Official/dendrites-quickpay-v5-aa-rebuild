# Status

## ✅ Completed
- QuickPay V5 send flow (SPONSORED + SELF_PAY)
- Receipts + private notes (Supabase)
- Faucet (mDNDX + USDC guidance + waitlist verify)
- Wallet Health activity proxy

## 🔒 Locked invariants
- **SPONSORED (default):** user pays 0 gas; fee taken in same token sent → FeeVault
- **SELF_PAY:** user pays gas; fee = 0
- Do not change contract addresses or core send logic

## 🚧 In Progress / Next
- Faucet v1 polish (waitlist gating, logging, limits)
- Universal Tx Queue / Nonce Rescue v2 (replace/cancel UX, fee presets, guidance)
- Wallet Health expansions (contract tagging, approvals history)

## Known issues + where to look
- Faucet config/claim errors: apps/quickpay-api/src/routes/faucet.js
- Wallet activity missing: apps/quickpay-api/src/routes/wallet.js (BASESCAN_* env)
- Receipt fetch issues: supabase/functions/quickpay_receipt, apps/dendrites-testnet-ui/src/lib/receiptsApi.ts
- CORS/UI connection: apps/quickpay-api/src/index.js (CORS_ORIGIN)
