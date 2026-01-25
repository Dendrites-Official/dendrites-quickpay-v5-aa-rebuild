import { ethers } from "ethers";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getQuote } from "./quote.js";

function isAddr(x) {
  return typeof x === "string" && ethers.isAddress(x.trim());
}

function resolveScriptPath(scriptName) {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "scripts", "aa", scriptName),
    path.join(cwd, "..", "..", "scripts", "aa", scriptName),
    path.join(cwd, "..", "scripts", "aa", scriptName),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function runLaneScript({ scriptName, lane, env }) {
  const scriptPath = resolveScriptPath(scriptName);
  if (!scriptPath) {
    if (lane === "EIP2612") {
      throw new Error("EIP2612 script missing");
    }
    throw new Error(`Script not found for lane ${lane}: ${scriptName}`);
  }

  const tmpDir = "/tmp";
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(
    tmpDir,
    `quickpay-${lane}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );

  const result = spawnSync("node", [scriptPath, "--json-out", tmpFile], {
    env,
    encoding: "utf-8",
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const exitCode = typeof result.status === "number" ? result.status : null;

  if (result.error || exitCode !== 0) {
    const err = new Error(`Lane ${lane} script failed: ${stderr}`.trim());
    err.details = { stdout, stderr, exitCode };
    throw err;
  }

  const raw = fs.readFileSync(tmpFile, "utf-8");
  const json = JSON.parse(raw);

  return {
    ok: true,
    lane,
    userOpHash: json.userOpHash ?? json.userOp?.userOpHash ?? null,
    txHash: json.txHash ?? json.transactionHash ?? null,
    feeAmountRaw: json.feeAmountRaw ?? json.feeTokenAmount ?? null,
    netAmountRaw: json.netAmountRaw ?? json.netAmount ?? null,
  };
}

export async function sendSponsored({
  chainId,
  rpcUrl,
  bundlerUrl,
  entryPoint,
  router,
  paymaster,
  factory,
  feeVault,
  ownerEoa,
  token,
  to,
  amount,
  feeMode,
  speed,
  auth,
}) {
  const routerAddr = String(router || process.env.ROUTER || "").trim();
  const owner = String(ownerEoa || "").trim();
  const tokenAddr = String(token || "").trim();
  const toAddr = String(to || "").trim();
  const amt = String(amount || "").trim();
  const rpc = String(rpcUrl || process.env.RPC_URL || "").trim();

  if (![84532, "84532"].includes(chainId)) {
    throw new Error(`Unsupported chainId: ${chainId}`);
  }
  for (const [k, v] of [
    ["router", routerAddr],
    ["ownerEoa", owner],
    ["token", tokenAddr],
    ["to", toAddr],
  ]) {
    if (!isAddr(v)) throw new Error(`Invalid ${k} address: "${v}"`);
  }
  if (!/^\d+$/.test(amt)) throw new Error(`Invalid amount (must be uint string): "${amt}"`);

  const q = await getQuote({
    chainId,
    rpcUrl: rpc,
    bundlerUrl,
    entryPoint,
    router: routerAddr,
    paymaster: paymaster || process.env.PAYMASTER,
    factoryAddress: factory || process.env.FACTORY,
    feeVault: feeVault || process.env.FEEVAULT,
    ownerEoa: owner,
    token: tokenAddr,
    amount: amt,
    feeMode,
    speed,
  });

  if (!q.feeTokenAmount || !/^\d+$/.test(String(q.feeTokenAmount)) || String(q.feeTokenAmount) === "0") {
    throw new Error(`Invalid feeTokenAmount from quote: ${q.feeTokenAmount}`);
  }

  if (q.lane === "EIP3009") {
    if (!auth || auth.type !== "EIP3009") {
      throw new Error(`Missing/invalid auth. Expected auth.type="EIP3009"`);
    }
    if (String(auth.from || "").toLowerCase() !== owner.toLowerCase()) {
      throw new Error(`auth.from mismatch`);
    }
    if (String(auth.to || "").toLowerCase() !== routerAddr.toLowerCase()) {
      throw new Error(`auth.to mismatch (must be router)`);
    }
    if (String(auth.value || "") !== amt) {
      throw new Error(`auth.value mismatch`);
    }
  }

  let scriptName;
  if (q.lane === "EIP3009") scriptName = "send_eip3009_v5.mjs";
  else if (q.lane === "PERMIT2") scriptName = "send_permit2_v5.mjs";
  else if (q.lane === "EIP2612") scriptName = "send_eip2612_v5.mjs";
  else throw new Error(`Unsupported lane for this send endpoint: ${q.lane}`);

  const env = {
    ...process.env,
    RPC_URL: rpc,
    BUNDLER_URL: bundlerUrl || process.env.BUNDLER_URL,
    CHAIN_ID: String(chainId),
    ENTRYPOINT: entryPoint || process.env.ENTRYPOINT,
    ROUTER: routerAddr,
    PAYMASTER: paymaster || process.env.PAYMASTER,
    FACTORY: factory || process.env.FACTORY,
    FEEVAULT: feeVault || process.env.FEEVAULT,
    PERMIT2: process.env.PERMIT2,
    TOKEN: tokenAddr,
    TO: toAddr,
    AMOUNT: amt,
    OWNER_EOA: owner,
    SPEED: speed,
    FEE_MODE: feeMode,
    FINAL_FEE_TOKEN: String(q.feeTokenAmount),
    FINAL_FEE: String(q.feeTokenAmount),
  };
  if (auth) env.AUTH_JSON = JSON.stringify(auth);

  return runLaneScript({ scriptName, lane: q.lane, env });
}
