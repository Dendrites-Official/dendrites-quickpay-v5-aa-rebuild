# Dendrites QuickPay V5

QuickPay V5 is a gas-abstracted transfer flow with receipts, faucet support, and wallet health activity checks. It pairs a Vite UI with a Fastify API (Railway), plus Supabase Edge Functions for receipts/notes.

## Locked rules (do not change)
- **SPONSORED (default):** user pays $0 gas; fee taken in the **same token sent** → FeeVault
- **SELF_PAY:** user pays gas; fee = 0

## Repo modules
- UI: [apps/dendrites-testnet-ui](apps/dendrites-testnet-ui)
- API (Railway): [apps/quickpay-api](apps/quickpay-api)
- Receipts explorer UI: [apps/receipt-explorer](apps/receipt-explorer)
- Supabase functions/migrations: [supabase](supabase)
- Scripts/tools: [scripts](scripts)
- Docs: [docs/STATUS.md](docs/STATUS.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/ROUTES.md](docs/ROUTES.md), [docs/ENV.md](docs/ENV.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/RUNBOOK.md](docs/RUNBOOK.md), [docs/ROADMAP.md](docs/ROADMAP.md)

## What’s Live
- Railway URL: **<ADD_RAILWAY_URL>**
- Health probe: `<ADD_RAILWAY_URL>/health`
- Quote probe: `<ADD_RAILWAY_URL>/quote`

## What we built
- [x] QuickPay V5 send (sponsored + self-pay)
- [x] Receipts + private notes
- [x] Faucet flow (mDNDX + USDC guidance)
- [x] Wallet Health activity proxy

## What’s next
- [ ] Faucet final polish (waitlist gating, logging, limits)
- [ ] Universal Tx Queue / Nonce Rescue upgrades (replace/cancel, fee presets, guidance)

## Quickstart (local dev)

### 1) API (Fastify)
```bash
cd apps/quickpay-api
npm install
npm run dev
```

### 2) UI (Vite)
```bash
cd apps/dendrites-testnet-ui
npm install
npm run dev
```

### Env doctor (sanity check)
```bash
node scripts/doctor.mjs
```

## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```

## Deployment
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Railway + GitHub steps and the full env checklist.
