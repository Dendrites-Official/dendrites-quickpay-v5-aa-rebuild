# Runbook

## Common tasks

### Run UI locally
```
cd apps/dendrites-testnet-ui
npm install
npm run dev
```

### Run API locally
```
cd apps/quickpay-api
npm install
npm run dev
```

### Verify Faucet works
1) Open `/faucet` in the UI.
2) Check config loads (`/faucet/config`).
3) Verify waitlist → sign message → claim.
4) Confirm tx hash returns and shows in wallet history.

### Verify Wallet Health activity works
1) Open `/wallet` in the UI.
2) Confirm `/wallet/activity/txlist` returns items for a known address.
3) If empty, check BASESCAN_* env variables and rate limits.

### Wallet QA Harness
Internal-only QA checks for Wallet Health, Activity, Approvals, Risk, Tx Queue, and Nonce Rescue.

**Local**
1) Start the UI (`npm run dev`).
2) Open `/qa-wallet` directly in the browser (no nav link).
3) Connect a wallet **or** paste an address for read-only checks.
4) Select Base Sepolia (84532) or Base Mainnet (8453) and click **Run Checks**.
5) Use **Export report** to download JSON results.

**Prod**
1) Deploy the latest API + UI.
2) Open `/qa-wallet` directly.
3) Run checks on both 84532 and 8453 for a known wallet.
4) Ensure Blockscout envs are configured for the selected chain.

### Rotate keys safely
1) Update Railway env vars (new keys).
2) Redeploy API.
3) Confirm `/health` and `/quote` are green.
4) Revoke old keys after validation.

## Repo hygiene note
If you accidentally committed build artifacts or node_modules, remove them in the next commit:
```
git rm -r --cached node_modules dist build
```
