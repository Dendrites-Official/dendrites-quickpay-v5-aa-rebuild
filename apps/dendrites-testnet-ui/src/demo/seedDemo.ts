import { createDemoReceipt, DEMO_ADDRESS, DEMO_CHAIN_ID, DEMO_MDNDX, DEMO_USDC, DEMO_WETH } from "./demoData";
import type { DemoReceipt } from "./demoData";

export const DEMO_SEEDED_KEY = "DENDRITES_DEMO_SEEDED";

export type DemoQuickPayDefaults = {
  tokenPreset: "usdc" | "mdndx" | "weth";
  token: string;
  decimals: number;
  to: string;
  amount: string;
  speed: 0 | 1;
  mode: "SPONSORED" | "SELF_PAY";
  name: string;
  message: string;
  reason: string;
  note: string;
};

export type DemoAckLinkDefaults = {
  amount: string;
  speed: "eco" | "instant";
  name: string;
  message: string;
  reason: string;
  note: string;
  code?: string;
};

export type DemoBulkDefaults = {
  recipients: string;
  name: string;
  message: string;
  reason: string;
  note: string;
  speed: 0 | 1;
  amountMode: "net" | "plusFee";
};

export type DemoNonceDefaults = {
  txHash: string;
  nonce: string;
  to: string;
  value: string;
  data: string;
  maxFee: string;
  maxPriorityFee: string;
};

export type DemoDefaults = {
  quickPay: DemoQuickPayDefaults;
  ackLink: DemoAckLinkDefaults;
  bulk: DemoBulkDefaults;
  nonce: DemoNonceDefaults;
};

export const demoQuickPayPresets: DemoQuickPayDefaults[] = [
  {
    tokenPreset: "usdc",
    token: DEMO_USDC,
    decimals: 6,
    to: "0x8E5eF73c74C4a4c86a5c7F9AA5B4cA64A5f71d6f",
    amount: "10.00",
    speed: 0,
    mode: "SPONSORED",
    name: "Dendrites Ops",
    message: "Thanks for moving quickly on this.",
    reason: "Invoice DX-104",
    note: "Demo payment seeded.",
  },
  {
    tokenPreset: "mdndx",
    token: DEMO_MDNDX,
    decimals: 18,
    to: "0x12D7E3Ece6dA7b9f4F7A2f1e8fE2A8C1b8fA53E1",
    amount: "25",
    speed: 1,
    mode: "SPONSORED",
    name: "Dendrites Rewards",
    message: "Quarterly incentive payout.",
    reason: "Performance bonus",
    note: "Demo incentive only.",
  },
  {
    tokenPreset: "weth",
    token: DEMO_WETH,
    decimals: 18,
    to: "0x0bA77E1792B8c6D1d8d4E5f0aE0a5eC5b1b8C7A2",
    amount: "0.05",
    speed: 1,
    mode: "SELF_PAY",
    name: "Dendrites Treasury",
    message: "Reimbursement approved.",
    reason: "Ops reimbursement",
    note: "Demo-only self-pay.",
  },
];

export const demoAckLinkPresets: DemoAckLinkDefaults[] = [
  {
    amount: "10.00",
    speed: "eco",
    name: "Dendrites Ops",
    message: "Here is your sponsored USDC link.",
    reason: "Vendor payout",
    note: "Demo link created.",
  },
  {
    amount: "25.00",
    speed: "instant",
    name: "Dendrites Finance",
    message: "Thank you for your work. Claim at your convenience.",
    reason: "Services rendered",
    note: "Demo AckLink only.",
  },
];

export const demoBulkPresets: DemoBulkDefaults[] = [
  {
    recipients: [
      "0x2b9d5d7c4a6b7e8f9012a3b4c5d6e7f8a9b0c1d2 12.50",
      "0x7f8e9d0c1b2a3c4d5e6f7a8b9c0d1e2f3a4b5c6d 7.25",
      "0x4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c 9.10",
    ].join("\n"),
    name: "Dendrites Ops",
    message: "Bulk payouts for sprint delivery.",
    reason: "Sprint payouts",
    note: "Demo bulk payout.",
    speed: 0,
    amountMode: "plusFee",
  },
  {
    recipients: [
      "0x55b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9 15",
      "0xd1c2b3a4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 11",
      "0xaabbccddeeff00112233445566778899aabbccdd 8",
      "0x9b31bdf5c7dba2b1b9fc1b7a2e4c1a67b1d2e3f4 6.75",
    ].join("\n"),
    name: "Dendrites Finance",
    message: "Team distribution for demos.",
    reason: "Team distribution",
    note: "Demo bulk only.",
    speed: 1,
    amountMode: "plusFee",
  },
];

export const demoNoncePresets: DemoNonceDefaults[] = [
  {
    txHash: "0x7b9b1f7e1a2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d",
    nonce: "42",
    to: "0x8E5eF73c74C4a4c86a5c7F9AA5B4cA64A5f71d6f",
    value: "0",
    data: "0x",
    maxFee: "32",
    maxPriorityFee: "2",
  },
  {
    txHash: "0x3a5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c",
    nonce: "58",
    to: "0x12D7E3Ece6dA7b9f4F7A2f1e8fE2A8C1b8fA53E1",
    value: "0",
    data: "0x",
    maxFee: "40",
    maxPriorityFee: "3",
  },
];

export function createDemoCode() {
  try {
    const bytes = new Uint8Array(4);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    const num =
      ((bytes[0] << 24) >>> 0) + ((bytes[1] << 16) >>> 0) + ((bytes[2] << 8) >>> 0) + (bytes[3] >>> 0);
    return String(num % 1000000).padStart(6, "0");
  } catch {
    return String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
  }
}

const buildSeedReceipts = (): DemoReceipt[] => {
  const now = Date.now();
  return [
    createDemoReceipt({
      amount_raw: "10000000",
      fee_amount_raw: "50000",
      fee_mode: "eco",
      to: "0x8E5eF73c74C4a4c86a5c7F9AA5B4cA64A5f71d6f",
      created_at: new Date(now - 1000 * 60 * 6).toISOString(),
      meta: { route: "send", note: "Demo seed payout" },
    }),
    createDemoReceipt({
      amount_raw: "35000000",
      fee_amount_raw: "175000",
      fee_mode: "instant",
      to: "0x12D7E3Ece6dA7b9f4F7A2f1e8fE2A8C1b8fA53E1",
      created_at: new Date(now - 1000 * 60 * 14).toISOString(),
      meta: { route: "send", note: "Demo milestone" },
    }),
    createDemoReceipt({
      token: DEMO_MDNDX,
      token_symbol: "mDNDX",
      token_decimals: 18,
      amount_raw: "12000000000000000000",
      fee_amount_raw: "60000000000000000",
      fee_mode: "instant",
      to: "0x9B31bdf5C7dBa2b1B9fC1b7a2e4c1A67b1d2E3F4",
      created_at: new Date(now - 1000 * 60 * 24).toISOString(),
      meta: { route: "send", note: "Demo incentive" },
    }),
    createDemoReceipt({
      amount_raw: "22000000",
      fee_amount_raw: "110000",
      fee_mode: "eco",
      to: "0x0bA77E1792B8c6D1d8d4E5f0aE0a5eC5b1b8C7A2",
      created_at: new Date(now - 1000 * 60 * 38).toISOString(),
      meta: { route: "send", note: "Demo operations" },
    }),
    createDemoReceipt({
      amount_raw: "48000000",
      fee_amount_raw: "240000",
      fee_mode: "instant",
      to: "0x55b1C2d3E4f5A6b7c8D9e0F1a2B3c4D5e6F7a8B9",
      created_at: new Date(now - 1000 * 60 * 52).toISOString(),
      meta: { route: "send", note: "Demo settlement" },
    }),
  ];
};

const defaultDemo: DemoDefaults = {
  quickPay: demoQuickPayPresets[0],
  ackLink: demoAckLinkPresets[0],
  bulk: demoBulkPresets[0],
  nonce: demoNoncePresets[0],
};

export function seedDemo(
  addReceipt?: (receipt: DemoReceipt) => void,
  receiptCount: number = 0,
  options?: { force?: boolean }
) {
  const defaults = defaultDemo;
  if (typeof window === "undefined") return { seeded: false, ...defaults };

  const force = Boolean(options?.force);
  const alreadySeeded = window.localStorage.getItem(DEMO_SEEDED_KEY) === "1";

  if (!force && (alreadySeeded || receiptCount >= 5 || !addReceipt)) {
    return { seeded: false, ...defaults };
  }

  if (force) {
    try {
      window.localStorage.removeItem(DEMO_SEEDED_KEY);
    } catch {
      // ignore
    }
  }

  const seeds = buildSeedReceipts();
  for (const receipt of seeds) {
    addReceipt?.(receipt);
  }

  try {
    window.localStorage.setItem(DEMO_SEEDED_KEY, "1");
  } catch {
    // ignore
  }

  return { seeded: true, ...defaults };
}

export function resetDemoSeedFlag() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DEMO_SEEDED_KEY);
  } catch {
    // ignore
  }
}

export function getDefaultDemoPresets() {
  return defaultDemo;
}

export function getPresetByIndex<T>(presets: T[], index: number) {
  if (!presets.length) return null;
  const idx = ((index % presets.length) + presets.length) % presets.length;
  return presets[idx];
}

export function getDemoSender() {
  return DEMO_ADDRESS.toLowerCase();
}

export function getDemoChainId() {
  return DEMO_CHAIN_ID;
}

export function getDemoTokenSymbol(token: string) {
  const lower = token.toLowerCase();
  if (lower === DEMO_USDC.toLowerCase()) return "USDC";
  if (lower === DEMO_MDNDX.toLowerCase()) return "mDNDX";
  if (lower === DEMO_WETH.toLowerCase()) return "WETH";
  return "TOKEN";
}
