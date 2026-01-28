import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const envFiles = [
  ".env",
  ".env.local",
  "apps/dendrites-testnet-ui/.env",
  "apps/dendrites-testnet-ui/.env.local",
  "apps/quickpay-api/.env",
  "apps/quickpay-api/.env.local",
  "supabase/.env",
  "supabase/.env.local",
];

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const cleaned = line.startsWith("export ") ? line.slice(7) : line;
    const eqIndex = cleaned.indexOf("=");
    if (eqIndex < 1) continue;
    const key = cleaned.slice(0, eqIndex).trim();
    let value = cleaned.slice(eqIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const envFromFiles = envFiles.reduce((acc, rel) => {
  const fullPath = path.join(repoRoot, rel);
  const parsed = parseEnvFile(fullPath);
  return { ...acc, ...parsed };
}, {});

function getEnv(key) {
  return process.env[key] ?? envFromFiles[key] ?? "";
}

function hasAny(keys) {
  return keys.some((key) => Boolean(getEnv(key)));
}

function printSection(title, required, optional, groups = []) {
  const missing = [];
  for (const key of required) {
    if (!getEnv(key)) missing.push(key);
  }
  for (const group of groups) {
    if (!hasAny(group.keys)) missing.push(group.label);
  }

  console.log(`\n${title}`);
  console.log("- required:");
  for (const key of required) {
    console.log(`  - ${key}: ${getEnv(key) ? "ok" : "missing"}`);
  }
  for (const group of groups) {
    console.log(`  - ${group.label}: ${hasAny(group.keys) ? "ok" : "missing"}`);
  }

  if (optional.length) {
    console.log("- optional:");
    for (const key of optional) {
      console.log(`  - ${key}: ${getEnv(key) ? "set" : "unset"}`);
    }
  }

  return missing;
}

console.log("QuickPay V5 env doctor");
console.log(`Loaded ${Object.keys(envFromFiles).length} vars from .env files (if present).`);

const uiRequired = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];
const uiOptional = [
  "VITE_QUICKPAY_API_URL",
  "VITE_WALLETCONNECT_PROJECT_ID",
  "VITE_USDC_ADDRESS",
  "VITE_MDNDX_ADDRESS",
];

const apiRequired = [
  "RPC_URL",
  "BUNDLER_URL",
  "FACTORY",
  "ROUTER",
  "PERMIT2",
  "FEEVAULT",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const apiOptional = [
  "CHAIN_ID",
  "ENTRYPOINT",
  "CORS_ORIGIN",
  "EIP3009_TOKENS",
  "EIP2612_TOKENS",
  "MAX_FEE_USDC6",
  "MAX_FEE_USD6",
  "MAX_FEE_USDC",
  "STIPEND_WEI",
  "STIPEND_FUNDER_PRIVATE_KEY",
  "TESTNET_RELAYER_PRIVATE_KEY",
  "QUICKPAY_DEBUG",
  "PORT",
];

const faucetRequired = [
  "WAITLIST_SUPABASE_URL",
  "WAITLIST_SUPABASE_SERVICE_ROLE_KEY",
  "IP_HASH_SALT",
  "FAUCET_PRIVATE_KEY",
];
const faucetOptional = [
  "TURNSTILE_DISABLED",
  "TURNSTILE_SECRET_KEY",
  "FAUCET_MDNDX_TOKEN",
  "MDNDX",
  "MDNDX_TOKEN",
  "FAUCET_MDNDX_DECIMALS",
  "FAUCET_MDNDX_DRIP_UNITS",
];

const explorerRequired = ["BASESCAN_API_URL"];
const explorerOptional = ["BASESCAN_API_KEY", "BASESCAN_EXPLORER_BASE_URL", "ACTIVITY_CACHE_TTL_MS"];

const missing = [];
missing.push(...printSection("UI", uiRequired, uiOptional));
missing.push(
  ...printSection("API", apiRequired, apiOptional, [
    { label: "PAYMASTER_ADDRESS or PAYMASTER", keys: ["PAYMASTER_ADDRESS", "PAYMASTER"] },
  ])
);
missing.push(...printSection("Faucet (if enabled)", faucetRequired, faucetOptional, [
  { label: "FAUCET_MDNDX_TOKEN or MDNDX/MDNDX_TOKEN", keys: ["FAUCET_MDNDX_TOKEN", "MDNDX", "MDNDX_TOKEN"] },
]));
missing.push(...printSection("Wallet Health (Explorer)", explorerRequired, explorerOptional));

const apiUrl = String(getEnv("BASESCAN_API_URL") || "");
const explorerUrl = String(getEnv("BASESCAN_EXPLORER_BASE_URL") || "");
let provider = "Not configured";
const providerHint = `${apiUrl} ${explorerUrl}`.toLowerCase();
if (apiUrl || explorerUrl) {
  if (providerHint.includes("blockscout")) provider = "Blockscout (recommended)";
  else if (providerHint.includes("basescan") || providerHint.includes("etherscan")) provider = "Etherscan-compatible";
  else provider = "Custom";
}
console.log(`\nExplorer provider: ${provider}`);

const missingRequired = missing.filter(Boolean);
if (missingRequired.length) {
  console.error(`\nMissing required env vars: ${missingRequired.join(", ")}`);
  process.exit(1);
}

console.log("\nAll required env vars present.");
