import "dotenv/config";
import { ethers } from "ethers";

const QP_URL = String(process.env.QP_URL || "http://localhost:3000").replace(/\/$/, "");
const CHAIN_ID = Number(process.env.CHAIN_ID || 84532);
const OWNER_EOA = String(process.env.OWNER_EOA || "").trim();
const TOKEN = String(process.env.TOKEN || "").trim();
const TO = String(process.env.TO || "").trim();
const AMOUNT = String(process.env.AMOUNT || "").trim();
const DECIMALS = Number(process.env.DECIMALS || 6);
const SPEED = Number(process.env.SPEED ?? 1);
const MODE = String(process.env.MODE || "SPONSORED").toUpperCase();

const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function toBigInt(value, label) {
  if (value == null || value === "") return null;
  try {
    return BigInt(value);
  } catch (err) {
    fail(`Invalid ${label}: ${value}`);
  }
}

function requireEnv(name, value) {
  if (!value) fail(`Missing env ${name}`);
}

requireEnv("OWNER_EOA", OWNER_EOA);
requireEnv("TOKEN", TOKEN);
requireEnv("TO", TO);
requireEnv("AMOUNT", AMOUNT);

const speedLabel = SPEED === 0 ? "instant" : "eco";
const amountRaw = ethers.parseUnits(AMOUNT, DECIMALS).toString();

const body = {
  chainId: CHAIN_ID,
  ownerEoa: OWNER_EOA,
  token: TOKEN,
  to: TO,
  amount: amountRaw,
  feeMode: speedLabel,
  speed: SPEED,
  mode: MODE,
};

if (process.env.OVERRIDE_MAX_FEE_USDC6) {
  body.maxFeeUsd6 = String(process.env.OVERRIDE_MAX_FEE_USDC6);
}
if (process.env.OMIT_MAX_FEE_USDC6 === "1") {
  delete body.maxFeeUsd6;
}

console.log(`REQUEST_JSON=${JSON.stringify(body)}`);

const res = await fetch(`${QP_URL}/quote`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const resp = await res.json().catch(() => ({}));
console.log(`QUOTE_JSON=${JSON.stringify(resp)}`);

if (!res.ok || resp?.ok === false) {
  fail(resp?.error || `HTTP ${res.status}`);
}

const errors = [];

const feeUsd6 = toBigInt(resp?.feeUsd6, "feeUsd6");
const feeTokenAmount = toBigInt(resp?.feeTokenAmount, "feeTokenAmount");
const maxFeeUsd6 = toBigInt(resp?.maxFeeUsd6, "maxFeeUsd6");
const baselineUsd6 = toBigInt(resp?.baselineUsd6, "baselineUsd6") ?? 0n;
const surchargeUsd6 = toBigInt(resp?.surchargeUsd6, "surchargeUsd6") ?? 0n;
const firstTxSurchargeApplies = Boolean(resp?.firstTxSurchargeApplies);

if (MODE === "SPONSORED") {
  if (resp?.sponsored !== true) {
    errors.push("sponsored should be true for SPONSORED mode");
  }
}

if (feeUsd6 == null || feeUsd6 <= 0n) {
  errors.push("feeUsd6 must be > 0");
}

if (String(TOKEN).toLowerCase() === USDC_BASE_SEPOLIA.toLowerCase()) {
  if (feeTokenAmount == null || feeTokenAmount <= 0n) {
    errors.push("feeTokenAmount must be > 0 for USDC");
  }
}

if (maxFeeUsd6 == null || feeUsd6 == null || maxFeeUsd6 < feeUsd6) {
  errors.push("maxFeeUsd6 must be >= feeUsd6");
}

if (firstTxSurchargeApplies) {
  if (feeUsd6 == null || feeUsd6 < baselineUsd6) {
    errors.push("feeUsd6 must be >= baselineUsd6 when firstTxSurchargeApplies");
  }
}

if (surchargeUsd6 > 0n) {
  if (feeUsd6 == null || feeUsd6 !== baselineUsd6 + surchargeUsd6) {
    errors.push("feeUsd6 must equal baselineUsd6 + surchargeUsd6 when surcharge applies");
  }
}

if (errors.length) {
  for (const err of errors) {
    console.error(`FAIL: ${err}`);
  }
  process.exit(1);
}

console.log("PASS");
process.exit(0);
