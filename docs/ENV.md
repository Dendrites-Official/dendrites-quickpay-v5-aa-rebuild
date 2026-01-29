# Environment Variables

> Never commit secrets. Set secrets in Railway/Vercel variables; never commit .env. Only .env.example should exist in git.

## UI (VITE_*)

| Variable | Required | Purpose | Example |
| --- | --- | --- | --- |
| VITE_SUPABASE_URL | ✅ | Supabase project URL | https://jusjvgdvivvbafmidvmb.supabase.co |
| VITE_SUPABASE_ANON_KEY | ✅ | Supabase anon key | <VITE_SUPABASE_ANON_KEY> |
| VITE_QUICKPAY_API_URL | Optional | API base URL (Railway) | https://<railway-app>.up.railway.app |
| VITE_WALLETCONNECT_PROJECT_ID | Optional | WalletConnect project id | 0123456789abcdef |
| VITE_USDC_ADDRESS | Optional | USDC token address | 0x... |
| VITE_MDNDX_ADDRESS | Optional | mDNDX token address | 0x... |

## API (Railway) — Core QuickPay

| Variable | Required | Purpose | Example |
| --- | --- | --- | --- |
| RPC_URL | ✅ | Chain RPC URL | https://base-sepolia.rpc... |
| BUNDLER_URL | ✅ | Bundler endpoint | https://<bundler> |
| CHAIN_ID | Optional | Chain id (default 84532) | 84532 |
| PAYMASTER | ✅ | Paymaster address | 0x... |
| FACTORY | ✅ | Smart account factory | 0x... |
| ROUTER | ✅ | QuickPay router | 0x... |
| PERMIT2 | ✅ | Permit2 address | 0x... |
| FEEVAULT | ✅ | FeeVault address | 0x... |
| ENTRYPOINT | Optional | ERC-4337 entry point | 0x... |
| EIP3009_TOKENS | Optional | Comma-separated tokens | 0x...,0x... |
| EIP2612_TOKENS | Optional | Comma-separated tokens | 0x...,0x... |
| MAX_FEE_USDC6 / MAX_FEE_USD6 / MAX_FEE_USDC | Optional | Fee cap | 250000 |
| STIPEND_WEI | Optional | Sponsored stipend | 120000000000000 |
| STIPEND_FUNDER_PRIVATE_KEY | Optional | Stipend funder key | <pk> |
| TESTNET_RELAYER_PRIVATE_KEY | Optional | Legacy relayer key | <pk> |
| CORS_ORIGIN | Optional | Allowed origins (CSV) | http://localhost:5173 |
| QUICKPAY_DEBUG | Optional | Debug logging (1) | 1 |
| PORT | Optional | API port | 8787 |

## API (Railway) — Faucet (if enabled)

| Variable | Required | Purpose | Example |
| --- | --- | --- | --- |
| SUPABASE_URL | ✅ | Supabase URL (faucet claims) | https://jusjvgdvivvbafmidvmb.supabase.co |
| SUPABASE_SERVICE_ROLE_KEY | ✅ | Supabase service role | eyJhbGciOi... |
| WAITLIST_SUPABASE_URL | ✅ | Waitlist Supabase URL | https://aamfaukbrosljxnhiwsv.supabase.co |
| WAITLIST_SUPABASE_SERVICE_ROLE_KEY | ✅ | Waitlist service role | eyJhbGciOi... |
| IP_HASH_SALT | ✅ | Hash salt for IP tracking | <random-string> |
| FAUCET_MDNDX_TOKEN | ✅ | mDNDX token address | 0x... |
| FAUCET_PRIVATE_KEY | ✅ | Faucet signer | <pk> |
| RPC_URL | ✅ | Chain RPC URL | https://base-sepolia.rpc... |
| TURNSTILE_DISABLED | Optional | Disable Turnstile (true/false) | false |
| TURNSTILE_SECRET_KEY | Required unless disabled | Turnstile secret | 0x... |
| FAUCET_MDNDX_DECIMALS | Optional | mDNDX decimals | 18 |
| FAUCET_MDNDX_DRIP_UNITS | Optional | Drip amount (raw units) | 20000000000000000000 |

## Supabase (current project)

| Variable | Required | Purpose | Example |
| --- | --- | --- | --- |
| SUPABASE_URL | ✅ | Project URL | https://jusjvgdvivvbafmidvmb.supabase.co |
| SUPABASE_ANON_KEY | ✅ | Public anon key | <SUPABASE_ANON_KEY> |
| SUPABASE_SERVICE_ROLE_KEY | ✅ | Service role key | <SUPABASE_SERVICE_ROLE_KEY> |

## Aliases (backwards compatible)
- PAYMASTER_ADDRESS → PAYMASTER (preferred)
- MDNDX, MDNDX_TOKEN → FAUCET_MDNDX_TOKEN (preferred)

## Explorer Activity (Blockscout)

| Variable | Required | Purpose | Example |
| --- | --- | --- | --- |
| BLOCKSCOUT_BASE_MAINNET_API_URL | ✅ | Base mainnet API | https://base.blockscout.com/api |
| BLOCKSCOUT_BASE_MAINNET_EXPLORER_BASE_URL | ✅ | Base mainnet explorer | https://base.blockscout.com |
| BLOCKSCOUT_BASE_SEPOLIA_API_URL | ✅ | Base Sepolia API | https://base-sepolia.blockscout.com/api |
| BLOCKSCOUT_BASE_SEPOLIA_EXPLORER_BASE_URL | ✅ | Base Sepolia explorer | https://base-sepolia.blockscout.com |
| ACTIVITY_CACHE_TTL_MS | Optional | Cache TTL (ms) | 30000 |
