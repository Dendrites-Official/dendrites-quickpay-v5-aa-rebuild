# Routes

## UI routes (dendrites-testnet-ui)

| Path | Purpose |
| --- | --- |
| / | Redirect to QuickPay |
| /quickpay | Send flow (QuickPay V5) |
| /receipts | Receipts list |
| /receipts/:id | Receipt detail view |
| /r/:id | Short receipt link |
| /faucet | mDNDX faucet + USDC guidance |
| /wallet | Wallet Health activity |
| /nonce-rescue | Nonce Rescue / Tx queue tools |

## API routes (quickpay-api + Supabase Edge Functions)

| Endpoint | Purpose |
| --- | --- |
| GET /health | Health check |
| POST /quote | Quote fee and user op plan |
| POST /send | Execute transfer (sponsored/self-pay) |
| GET /faucet/config | Faucet config + token metadata |
| POST /faucet/mdndx/verify | Verify waitlist status |
| POST /faucet/mdndx/join | Join waitlist (if enabled) |
| POST /faucet/mdndx/challenge | Message signing challenge |
| POST /faucet/mdndx/claim | Claim faucet drip |
| GET /wallet/activity/txlist | Wallet activity proxy (explorer) |
| GET /wallet/activity/tokentx | Token transfer discovery (explorer) |
| POST /wallet/approvals/scan | Approvals scanner (canonical) |
| POST /wallet/approvals/scan-v2 | Approvals scanner alias |
| POST /wallet/approvals_scan | Approvals scanner alias |
| POST /events/log | Analytics event logging |
| POST /functions/v1/quickpay_receipt | Receipt resolution (Supabase Edge) |
| GET/POST /functions/v1/quickpay_note | Private receipt notes (Supabase Edge) |
