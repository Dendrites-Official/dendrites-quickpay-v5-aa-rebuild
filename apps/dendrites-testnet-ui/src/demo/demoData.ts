export const DEMO_MODE_STORAGE_KEY = "DENDRITES_DEMO_MODE";

export const DEMO_CHAIN_ID = 84532;
export const DEMO_CHAIN_NAME = "Base Sepolia";
export const DEMO_ADDRESS = "0xD3C0D3c0D3c0D3c0D3c0D3c0D3c0D3c0D3c0D3c0";

export const DEMO_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const DEMO_WETH = "0x4200000000000000000000000000000000000006";
export const DEMO_MDNDX = "0x6F5D9eA73a07E8fBf86B80a4c8f3e7F5fB1F9D9B";
export const DEMO_ROUTER = "0x0D65e8e31dc33F6cf4A176a5B0e3ed4044c561EB";
export const DEMO_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export const DEMO_ACKLINK_VAULT = "0x8b3f6b0b7eF0c7cD9B2D2Bf3b4A0f1f4eE1fDc12";

export const DEMO_VIDEO_URL = "https://example.com/demo";

const HEX_CHARS = "0123456789abcdef";

function randomHex(len: number) {
  const bytes = new Uint8Array(Math.ceil(len / 2));
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += HEX_CHARS[(bytes[i] >> 4) & 0xf] + HEX_CHARS[bytes[i] & 0xf];
  }
  return out.slice(0, len);
}

export function createDemoReceiptId() {
  return `r_${randomHex(8)}`;
}

export function createDemoHash() {
  return `0x${randomHex(64)}`;
}

function safeBigInt(value: string | number | bigint | null | undefined) {
  try {
    if (value == null) return 0n;
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export type DemoReceipt = Record<string, any>;

export function createDemoReceipt(overrides: Partial<DemoReceipt>) {
  const amountRaw = String(overrides.amount_raw ?? overrides.amountRaw ?? "0");
  const feeRaw = String(overrides.fee_amount_raw ?? overrides.feeAmountRaw ?? "0");
  const netRaw = overrides.net_amount_raw ?? overrides.netAmountRaw;
  const netAmount =
    netRaw != null ? String(netRaw) : (safeBigInt(amountRaw) - safeBigInt(feeRaw)).toString();

  return {
    receipt_id: overrides.receipt_id ?? createDemoReceiptId(),
    status: overrides.status ?? "CONFIRMED",
    chain_id: overrides.chain_id ?? DEMO_CHAIN_ID,
    token: overrides.token ?? DEMO_USDC,
    token_symbol: overrides.token_symbol ?? "USDC",
    token_decimals: overrides.token_decimals ?? 6,
    amount_raw: amountRaw,
    net_amount_raw: netAmount,
    fee_amount_raw: feeRaw,
    fee_mode: overrides.fee_mode ?? "instant",
    fee_token_mode: overrides.fee_token_mode ?? "sponsored",
    lane: overrides.lane ?? null,
    title: overrides.title ?? overrides.message ?? null,
    display_name: overrides.display_name ?? overrides.displayName ?? null,
    reason: overrides.reason ?? null,
    note: overrides.note ?? null,
    reference_id: overrides.reference_id ?? overrides.referenceId ?? null,
    created_by: overrides.created_by ?? overrides.createdBy ?? null,
    to: overrides.to ?? "0x8E5eF73c74C4a4c86a5c7F9AA5B4cA64A5f71d6f",
    sender: overrides.sender ?? DEMO_ADDRESS.toLowerCase(),
    owner_eoa: overrides.owner_eoa ?? DEMO_ADDRESS.toLowerCase(),
    created_at: overrides.created_at ?? new Date().toISOString(),
    tx_hash: overrides.tx_hash ?? createDemoHash(),
    userop_hash: overrides.userop_hash ?? createDemoHash(),
    meta: overrides.meta ?? null,
    recipients_count: overrides.recipients_count,
  };
}

const now = Date.now();

export const demoReceipts: DemoReceipt[] = [
  createDemoReceipt({
    receipt_id: "r_demo01",
    amount_raw: "25000000",
    fee_amount_raw: "125000",
    net_amount_raw: "24875000",
    fee_mode: "instant",
    to: "0x12D7E3Ece6dA7b9f4F7A2f1e8fE2A8C1b8fA53E1",
    created_at: new Date(now - 1000 * 60 * 12).toISOString(),
    meta: { route: "send", note: "Payroll run" },
  }),
  createDemoReceipt({
    receipt_id: "r_demo02",
    token: DEMO_WETH,
    token_symbol: "WETH",
    token_decimals: 18,
    amount_raw: "32000000000000000",
    fee_amount_raw: "210000000000000",
    net_amount_raw: "31790000000000000",
    fee_mode: "eco",
    fee_token_mode: "self pay",
    to: "0x0bA77E1792B8c6D1d8d4E5f0aE0a5eC5b1b8C7A2",
    created_at: new Date(now - 1000 * 60 * 28).toISOString(),
    meta: { route: "send", note: "Vendor payout" },
  }),
  createDemoReceipt({
    receipt_id: "r_demo03",
    amount_raw: "9500000",
    fee_amount_raw: "95000",
    net_amount_raw: "9405000",
    fee_mode: "instant",
    to: "0x6C3A86b6C5E4D6A2C7cC1e5B3A9d6f8A3bC0e9F1",
    created_at: new Date(now - 1000 * 60 * 45).toISOString(),
    meta: { route: "send", note: "Service credit" },
  }),
  createDemoReceipt({
    receipt_id: "r_demo04",
    amount_raw: "54000000",
    fee_amount_raw: "270000",
    net_amount_raw: "53730000",
    fee_mode: "instant",
    to: "0x9B31bdf5C7dBa2b1B9fC1b7a2e4c1A67b1d2E3F4",
    created_at: new Date(now - 1000 * 60 * 80).toISOString(),
    meta: { route: "acklink_create", linkId: "al_demo_01", kind: "create", expiresAt: new Date(now + 1000 * 60 * 60 * 12).toISOString() },
  }),
  createDemoReceipt({
    receipt_id: "r_demo05",
    amount_raw: "120000000",
    fee_amount_raw: "600000",
    net_amount_raw: "119400000",
    fee_mode: "eco",
    to: "0xF2aB48cFd3E9C2a7E24fC7c1bD2c1a5E1f8C2a4B",
    created_at: new Date(now - 1000 * 60 * 120).toISOString(),
    meta: { route: "send", note: "Partner rebate" },
  }),
  createDemoReceipt({
    receipt_id: "r_demo06",
    amount_raw: "40000000",
    fee_amount_raw: "200000",
    net_amount_raw: "39800000",
    fee_mode: "instant",
    to: "0x7c6f1aE10B9a8c1B2c3d4e5F6a7b8C9D0E1F2A3b",
    created_at: new Date(now - 1000 * 60 * 180).toISOString(),
    meta: { route: "send", note: "Ops expense" },
  }),
  createDemoReceipt({
    receipt_id: "r_demo07",
    amount_raw: "89000000",
    fee_amount_raw: "445000",
    net_amount_raw: "88555000",
    fee_mode: "instant",
    created_at: new Date(now - 1000 * 60 * 260).toISOString(),
    meta: {
      route: "sendBulk",
      recipients: [
        { to: "0x2B9d5d7c4A6b7E8f9012a3b4c5D6e7F8a9b0c1d2", amount: "25000000" },
        { to: "0x7f8e9d0c1b2A3c4D5e6F7a8B9c0d1E2f3A4b5C6d", amount: "30000000" },
        { to: "0x4b5c6D7e8f9A0b1C2d3E4f5a6B7c8D9e0F1a2b3c", amount: "33500000" },
      ],
    },
    recipients_count: 3,
  }),
  createDemoReceipt({
    receipt_id: "r_demo08",
    amount_raw: "15000000",
    fee_amount_raw: "75000",
    net_amount_raw: "14925000",
    fee_mode: "eco",
    to: "0xD1c2b3a4E5f6A7b8c9D0E1F2a3B4c5d6e7F8a9B0",
    created_at: new Date(now - 1000 * 60 * 320).toISOString(),
    meta: { route: "send", note: "Test payout" },
  }),
  createDemoReceipt({
    receipt_id: "r_demo09",
    token: DEMO_MDNDX,
    token_symbol: "mDNDX",
    token_decimals: 18,
    amount_raw: "80000000000000000000",
    fee_amount_raw: "400000000000000000",
    net_amount_raw: "79600000000000000000",
    fee_mode: "instant",
    to: "0xAaBbCcDdEeFf00112233445566778899AAbBcCdD",
    created_at: new Date(now - 1000 * 60 * 420).toISOString(),
    meta: { route: "send", note: "Incentive" },
  }),
  createDemoReceipt({
    receipt_id: "r_demo10",
    amount_raw: "62000000",
    fee_amount_raw: "310000",
    net_amount_raw: "61690000",
    fee_mode: "instant",
    to: "0x55b1C2d3E4f5A6b7c8D9e0F1a2B3c4D5e6F7a8B9",
    created_at: new Date(now - 1000 * 60 * 520).toISOString(),
    meta: { route: "acklink_claim", linkId: "al_demo_02", kind: "claim" },
  }),
];

export const demoActivity = [
  {
    address: DEMO_ROUTER,
    count: 6,
    lastSeen: Math.floor((now - 1000 * 60 * 30) / 1000),
    hashes: [createDemoHash(), createDemoHash(), createDemoHash()],
    isContract: true,
  },
  {
    address: "0x9f1E2d3C4b5A6f7E8d9C0b1A2f3E4d5C6b7A8f9E",
    count: 3,
    lastSeen: Math.floor((now - 1000 * 60 * 90) / 1000),
    hashes: [createDemoHash(), createDemoHash()],
    isContract: false,
  },
];

export const demoWalletHealth = {
  nonceLatest: 128,
  noncePending: 128,
  nativeBalance: "2.4381",
  tokenBalances: {
    [DEMO_USDC]: "12450.32",
    [DEMO_WETH]: "3.12",
    [DEMO_MDNDX]: "1400.00",
  },
  tokenMeta: {
    [DEMO_USDC]: { symbol: "USDC", decimals: 6 },
    [DEMO_WETH]: { symbol: "WETH", decimals: 18 },
    [DEMO_MDNDX]: { symbol: "mDNDX", decimals: 18 },
  },
  mdndxAddress: DEMO_MDNDX,
  mdndxDecimals: 18,
  activityRows: demoActivity,
  explorerBaseUrl: "https://sepolia.basescan.org/tx/",
  scanResults: [
    {
      tokenAddress: DEMO_USDC,
      symbol: "USDC",
      decimals: 6,
      allowances: [
        {
          spender: "0x3a6C5b8E2d9f0a1B2c3D4e5F6a7B8c9D0E1F2a3B",
          allowance: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
          isUnlimited: true,
        },
      ],
    },
  ],
  tagMap: {},
};

export const demoQuickPayQuote = {
  lane: "PERMIT2",
  sponsored: true,
  feeUsd6: "350000",
  feeTokenAmount: "250000",
  netAmountRaw: "9750000",
  feeMode: "instant",
  speed: 1,
  router: DEMO_ROUTER,
  permit2: DEMO_PERMIT2,
  setupNeeded: [] as string[],
};

export const demoBulkQuote = {
  feeTokenAmount: "450000",
  feeAmountRaw: "450000",
  router: DEMO_ROUTER,
  paymaster: "0xE8a8B4b5C6d7E8F9a0B1c2D3e4F5a6B7c8D9E0F1",
};

export const demoAckLinkQuote = {
  feeUsdc6: "250000",
  acklinkVault: DEMO_ACKLINK_VAULT,
};

export function buildDemoQuickPayQuote(params: {
  amountRaw: string;
  decimals: number;
  speedLabel: string;
  speed: number;
  mode: "SPONSORED" | "SELF_PAY";
}) {
  const amount = safeBigInt(params.amountRaw);
  const fee = amount > 0n ? amount / 400n : 0n;
  const minFee = 1000n;
  const feeAmount = fee > minFee ? fee : minFee;
  const netAmount = amount > feeAmount ? amount - feeAmount : amount;
  const usdScale = params.decimals >= 6 ? 10n ** BigInt(params.decimals - 6) : 1n;
  const feeUsd6 = params.decimals >= 6 ? feeAmount / usdScale : feeAmount * 10n;

  return {
    ...demoQuickPayQuote,
    feeUsd6: feeUsd6.toString(),
    feeTokenAmount: feeAmount.toString(),
    netAmountRaw: netAmount.toString(),
    feeMode: params.speedLabel,
    speed: params.speed,
    sponsored: params.mode === "SPONSORED",
  };
}

export function buildDemoBulkQuote(totalNetRaw: bigint) {
  const fee = totalNetRaw > 0n ? totalNetRaw / 300n : 0n;
  const minFee = 200000n;
  const feeAmount = fee > minFee ? fee : minFee;
  return {
    ...demoBulkQuote,
    feeTokenAmount: feeAmount.toString(),
    feeAmountRaw: feeAmount.toString(),
  };
}
