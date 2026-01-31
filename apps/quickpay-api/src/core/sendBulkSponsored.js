// IMPORTANT: scripts must run from apps/quickpay-api/scripts/aa to avoid stale Railway builds.
import { ethers } from "ethers";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getQuote } from "./quote.js";
import { normalizeSpeed } from "./normalizeSpeed.js";
import { resolveRpcUrl } from "./resolveRpcUrl.js";
import { spawnWithTimeout } from "./withTimeout.js";

function isAddr(x) {
  return typeof x === "string" && ethers.isAddress(x.trim());
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ERC20_BALANCE_ABI = ["function balanceOf(address owner) view returns (uint256)"];

function resolveScriptPath(scriptName) {
  const root = process.cwd();
  const candidates = [
    path.join(root, "src", "aa", scriptName),
    path.join(root, "scripts", "aa", scriptName),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function runBulkScript({ scriptName, env }) {
  const scriptPath = resolveScriptPath(scriptName);
  if (!scriptPath) {
    const err = new Error(`Script not found for bulk lane: ${scriptName}`);
    if (env?.QUICKPAY_DEBUG === "1") {
      const root = process.cwd();
      err.details = {
        candidates: [
          path.join(root, "src", "aa", scriptName),
          path.join(root, "scripts", "aa", scriptName),
        ],
        cwd: root,
        __filename,
      };
    }
    throw err;
  }

  const tmpDir = "/tmp";
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(
    tmpDir,
    `quickpay-bulk-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );

  const timeoutMsRaw = Number(process.env.BULK_TIMEOUT_MS ?? 30000);
  const timeoutMs = Math.min(30000, Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 30000);

  const result = await spawnWithTimeout(
    "node",
    [scriptPath, "--json-out", tmpFile],
    { env, encoding: "utf-8" },
    timeoutMs,
    {
      code: "ORCHESTRATOR_TIMEOUT",
      status: 504,
      where: "runBulkScript",
      message: "ORCHESTRATOR_TIMEOUT",
    }
  );

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const exitCode = typeof result.exitCode === "number" ? result.exitCode : null;

  let json = null;
  if (fs.existsSync(tmpFile)) {
    const raw = fs.readFileSync(tmpFile, "utf-8");
    json = JSON.parse(raw);
  }

  if (result.error || exitCode !== 0) {
    if (json && json.needsUserOpSignature === true) {
      return { ...json, ok: false };
    }
    const err = new Error(`Bulk script failed: ${stderr}`.trim());
    err.details = { stdout, stderr, exitCode };
    if (env?.QUICKPAY_DEBUG === "1") {
      err.details.scriptPath = scriptPath;
    }
    throw err;
  }

  return {
    ok: true,
    lane: json.lane ?? "EIP3009_BULK",
    userOpHash: json.userOpHash ?? json.userOp?.userOpHash ?? null,
    txHash: json.txHash ?? json.transactionHash ?? null,
    feeAmountRaw: json.feeAmountRaw ?? json.feeTokenAmount ?? null,
    netAmountRaw: json.netAmountRaw ?? json.netAmount ?? null,
  };
}

export async function sendBulkSponsored({
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
  recipients,
  amounts,
  feeMode,
  speed,
  amountMode,
  auth,
  userOpSignature,
  userOpDraft,
  referenceId,
  logger,
}) {
  const { canonicalSpeed, canonicalFeeMode } = normalizeSpeed({ feeMode, speed });
  const speedNum = canonicalSpeed;
  const routerAddr = String(router || process.env.ROUTER_BULK || "").trim();
  const owner = String(ownerEoa || "").trim();
  const tokenAddr = String(token || "").trim();
  const rpc = String(rpcUrl || process.env.RPC_URL || "").trim();

  if (![84532, "84532"].includes(chainId)) {
    throw new Error(`Unsupported chainId: ${chainId}`);
  }
  for (const [k, v] of [
    ["router", routerAddr],
    ["ownerEoa", owner],
    ["token", tokenAddr],
  ]) {
    if (!isAddr(v)) throw new Error(`Invalid ${k} address: "${v}"`);
  }

  const usdcEnv = String(process.env.USDC || "").trim();
  const usdcDefault = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const requiredUsdc = usdcEnv || usdcDefault;
  if (requiredUsdc && tokenAddr.toLowerCase() !== requiredUsdc.toLowerCase()) {
    throw new Error("USDC only (token mismatch)");
  }

  const maxRecipients = Number(process.env.BULK_MAX_RECIPIENTS ?? 25);
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error("Missing recipients");
  }
  if (!Array.isArray(amounts) || amounts.length !== recipients.length) {
    throw new Error("Recipients/amounts length mismatch");
  }
  if (recipients.length > maxRecipients) {
    throw new Error(`Too many recipients (max ${maxRecipients})`);
  }

  const normalizedRecipients = [];
  for (const addr of recipients) {
    if (!isAddr(addr)) throw new Error(`Invalid recipient address: ${addr}`);
    normalizedRecipients.push(ethers.getAddress(addr));
  }

  let totalGross = 0n;
  const normalizedAmounts = amounts.map((value) => {
    const raw = String(value ?? "").trim();
    if (!/^\d+$/.test(raw)) {
      throw new Error(`Invalid amount (must be uint string): "${value}"`);
    }
    const amt = BigInt(raw);
    if (amt <= 0n) {
      throw new Error("Amount must be > 0");
    }
    totalGross += amt;
    return raw;
  });

  if (totalGross <= 0n) {
    throw new Error("Total amount must be > 0");
  }

  const resolvedRpc = await resolveRpcUrl({ rpcUrl: rpc, bundlerUrl, chainId });

  let finalFee = 0n;
  let maxFeeUsd6 = "";

  if (userOpDraft && userOpSignature) {
    finalFee = BigInt(String(userOpDraft.feeTokenAmount || "0"));
    maxFeeUsd6 = String(userOpDraft.maxFeeUsd6 || "");
  } else {
    const q = await getQuote({
      chainId,
      rpcUrl: resolvedRpc,
      bundlerUrl,
      entryPoint,
      router: routerAddr,
      paymaster: paymaster || process.env.PAYMASTER_BULK,
      factoryAddress: factory || process.env.FACTORY,
      feeVault: feeVault || process.env.FEEVAULT,
      ownerEoa: owner,
      token: tokenAddr,
      amount: totalGross.toString(),
      feeMode: canonicalFeeMode,
      speed: speedNum,
      permit2: process.env.PERMIT2,
      eip3009Tokens: process.env.EIP3009_TOKENS,
      eip2612Tokens: process.env.EIP2612_TOKENS,
      mode: "SPONSORED",
      logger,
    });

    if (q?.ok === false) {
      const err = new Error(q?.error || "QUOTE_FAILED");
      err.status = q?.statusCode || 400;
      throw err;
    }

    if (String(q?.lane || "").toUpperCase() !== "EIP3009") {
      throw new Error(`Unsupported lane for bulk: ${q?.lane}`);
    }

    if (!q.feeTokenAmount || !/^\d+$/.test(String(q.feeTokenAmount))) {
      throw new Error(`Invalid feeTokenAmount from quote: ${q.feeTokenAmount}`);
    }

    finalFee = BigInt(q.feeTokenAmount);
    maxFeeUsd6 = String(q.maxFeeUsd6 ?? "");
  }

  const modeRaw = String(amountMode || "plusFee").trim().toLowerCase();
  const modeUsed = modeRaw === "plusfee" || modeRaw === "plus_fee" || modeRaw === "plus" ? "plusFee" : "net";

  let adjustedAmounts = normalizedAmounts;
  let totalNet = totalGross;
  let totalWithFee = totalGross + finalFee;

  if (modeUsed === "net") {
    if (totalGross <= finalFee) {
      throw new Error("Total amount must be greater than fee for net mode");
    }
    totalNet = totalGross - finalFee;
    totalWithFee = totalGross;
    const lastIdx = adjustedAmounts.length - 1;
    const lastAmount = BigInt(adjustedAmounts[lastIdx]);
    if (lastAmount <= finalFee) {
      throw new Error("Last recipient amount must exceed fee for net mode");
    }
    adjustedAmounts = adjustedAmounts.map((value, idx) =>
      idx === lastIdx ? (BigInt(value) - finalFee).toString() : value
    );
  } else {
    totalNet = totalGross;
    totalWithFee = totalGross + finalFee;
  }

  if (!auth || auth.type !== "EIP3009") {
    throw new Error(`Missing/invalid auth. Expected auth.type="EIP3009"`);
  }
  if (String(auth.from || "").toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`auth.from mismatch`);
  }
  if (String(auth.to || "").toLowerCase() !== routerAddr.toLowerCase()) {
    throw new Error(`auth.to mismatch (must be router)`);
  }
  if (String(auth.value || "") !== String(totalWithFee)) {
    throw new Error(`auth.value mismatch`);
  }

  try {
    const provider = new ethers.JsonRpcProvider(resolvedRpc);
    const erc20 = new ethers.Contract(tokenAddr, ERC20_BALANCE_ABI, provider);
    const balance = await erc20.balanceOf(owner);
    if (BigInt(balance ?? 0n) < totalWithFee) {
      throw new Error(`Insufficient balance. Need ${totalWithFee} have ${balance}`);
    }
  } catch (err) {
    const message = err?.message || String(err);
    if (message.includes("Insufficient balance")) throw err;
    logger?.warn?.("BULK_BALANCE_CHECK_FAILED", { error: message });
  }

  let refId = String(referenceId || "").trim();
  if (!refId) {
    refId = `0x${crypto.randomBytes(32).toString("hex")}`;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(refId)) {
    throw new Error("Invalid referenceId (expected 32-byte hex)");
  }

  const env = {
    ...process.env,
    RPC_URL: resolvedRpc,
    BUNDLER_URL: bundlerUrl || process.env.BUNDLER_URL,
    CHAIN_ID: String(chainId),
    ENTRYPOINT: entryPoint || process.env.ENTRYPOINT,
    ROUTER: routerAddr,
    PAYMASTER: paymaster || process.env.PAYMASTER,
    FACTORY: factory || process.env.FACTORY,
    FEEVAULT: feeVault || process.env.FEEVAULT,
    TOKEN: tokenAddr,
    OWNER_EOA: owner,
    SPEED: String(speedNum),
    FEE_MODE: canonicalFeeMode,
    FINAL_FEE_TOKEN: String(finalFee),
    FINAL_FEE: String(finalFee),
    MAX_FEE_USDC6: String(maxFeeUsd6),
    RECIPIENTS_JSON: JSON.stringify(normalizedRecipients),
    AMOUNTS_JSON: JSON.stringify(adjustedAmounts),
    REFERENCE_ID: refId,
  };
  if (auth) env.AUTH_JSON = JSON.stringify(auth);
  if (userOpDraft) env.USEROP_DRAFT_JSON = JSON.stringify(userOpDraft);
  if (userOpSignature) env.USEROP_SIGNATURE = String(userOpSignature).trim();

  const result = await runBulkScript({ scriptName: "send_bulk_usdc_eip3009.mjs", env });

  return {
    ...result,
    referenceId: refId,
    feeAmountRaw: finalFee.toString(),
    netAmountRaw: totalNet.toString(),
    totalAmountRaw: totalWithFee.toString(),
    modeUsed,
    recipientAmounts: adjustedAmounts,
    recipientCount: adjustedAmounts.length,
  };
}
