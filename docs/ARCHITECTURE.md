# Architecture

```
[Wallet]
   |
   v
[UI (Vite)] ------------------------------+
   |                                       |
   |  /quote /send /faucet /wallet          |
   v                                       |
[QuickPay API (Railway/Fastify)]           |
   |             |                         |
   |             +--> [Chain RPC/Bundler]  |
   |                                       |
   +--> [Supabase (receipts/notes)] <------+

Faucet flow:
[Wallet] -> [UI] -> /faucet/* -> [API] -> [Supabase waitlist] + [RPC]

Wallet Health activity proxy:
[UI] -> /wallet/activity/txlist -> [API] -> [Explorer API] -> [UI]
```
