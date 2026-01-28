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
