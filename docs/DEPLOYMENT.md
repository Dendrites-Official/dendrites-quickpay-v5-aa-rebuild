# Deployment

## GitHub push workflow
1) Ensure secrets are **not** in git (`.env` stays gitignored).
2) `git status`
3) `git add -A`
4) `git commit -m "<message>"`
5) `git push origin <branch>`

## Railway variables checklist
> Names only. Fill values in Railway.

**Core API (required):**
- RPC_URL
- BUNDLER_URL
- CHAIN_ID
- PAYMASTER_ADDRESS (or PAYMASTER)
- FACTORY
- ROUTER
- PERMIT2
- FEEVAULT
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

**API (recommended/optional):**
- ENTRYPOINT
- CORS_ORIGIN
- EIP3009_TOKENS
- EIP2612_TOKENS
- MAX_FEE_USDC6 / MAX_FEE_USD6 / MAX_FEE_USDC
- STIPEND_WEI
- STIPEND_FUNDER_PRIVATE_KEY
- TESTNET_RELAYER_PRIVATE_KEY
- QUICKPAY_DEBUG
- PORT

**Faucet (required if enabled):**
- WAITLIST_SUPABASE_URL
- WAITLIST_SUPABASE_SERVICE_ROLE_KEY
- IP_HASH_SALT
- FAUCET_MDNDX_TOKEN (or MDNDX/MDNDX_TOKEN)
- FAUCET_PRIVATE_KEY
- TURNSTILE_SECRET_KEY (unless TURNSTILE_DISABLED=true)
- TURNSTILE_DISABLED
- FAUCET_MDNDX_DECIMALS
- FAUCET_MDNDX_DRIP_UNITS

**Wallet Health (Explorer):**
- BASESCAN_API_URL
- BASESCAN_API_KEY
- BASESCAN_EXPLORER_BASE_URL
- ACTIVITY_CACHE_TTL_MS

## Redeploy + verify
- Trigger a Railway deploy (push to tracked branch or redeploy in Railway UI).
- Verify: `GET /health` and `POST /quote` on the Railway URL.
