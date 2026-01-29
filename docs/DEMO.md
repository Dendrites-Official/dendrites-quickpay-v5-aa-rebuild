# Investor Demo Script (Wallet Suite)

> Goal: showcase Wallet Health, Approvals Scanner, Activity, Tx Queue, and Nonce Rescue without touching QuickPay flows.

## Flow A — Base Sepolia (84532)

**Pre-req:** connect a wallet on Base Sepolia.

1) **Wallet Health overview snapshot**
   - Open `/wallet`.
   - Confirm the **Investor Snapshot** card shows chain, pending txs, unlimited approvals, unknown contracts.

2) **Activity contracts list**
   - Click **Activity** tab.
   - Click **Refresh** to show recent contracts.
   - Point out known labels (Permit2, QuickPay Router, FeeVault if present).

3) **Scan approvals + show “unlimited”**
   - Go to **Approvals** tab.
   - Click **Scan approvals**.
   - If an unlimited approval appears, click **Revoke** (confirm modal shows gas estimate).
   - If none: create a safe unlimited approval by manually setting a test token + spender, approve Max/large value on Sepolia only, then rescan to show the risk.

4) **Tx Queue detection + suggested fix**
   - Go to `/tx-queue`.
   - Click **Load** (defaults to connected address).
   - If no pending txs, use **Demo: Create Stuck Tx** (Sepolia only). It sends a low-fee tx.
   - Refresh queue; pending range should appear.
   - Click **Cancel nonce (x2.0)** to show the fix flow.

5) **Nonce Rescue**
   - From `/tx-queue`, click **Back to QuickPay** then **Nonce Rescue** (or go to `/nonce-rescue`).
   - Show status and explain replacement strategy.

## Flow B — Base Mainnet (8453)

**Pre-req:** connect a wallet on Base mainnet.

1) **Wallet Health overview snapshot**
   - Open `/wallet`.
   - Show **Investor Snapshot** with chain=Base mainnet.

2) **Activity contracts list**
   - Click **Activity** tab → **Refresh**.
   - Show known labels and any tagged contracts.

3) **Scan approvals + show “unlimited”**
   - Go to **Approvals** tab → **Scan approvals**.
   - If unlimited approvals exist, demonstrate **Revoke**. 
   - Confirm modal will appear with **“You will spend real gas”** and a gas estimate.

4) **Tx Queue detection + suggested fix**
   - Go to `/tx-queue` → **Load**.
   - If pending txs exist, show suggested fix buttons.
   - Confirm modal shows gas estimate before any replacement.

5) **Nonce Rescue**
   - Open `/nonce-rescue` and show pending/latest nonces.
   - Explain cancel/speed-up workflow (confirmation gate on mainnet).

## If you don’t have a stuck tx
- On **Sepolia**, use **Demo: Create Stuck Tx** on `/tx-queue`.
- On **Mainnet**, avoid creating stuck txs; instead show the queue UI and explain how it would work.
