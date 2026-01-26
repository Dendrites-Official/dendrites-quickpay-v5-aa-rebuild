// IMPORTANT: scripts must run from apps/quickpay-api/scripts/aa to avoid stale Railway builds.
import { ethers } from "ethers";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getQuote } from "./quote.js";
import { normalizeSpeed } from "./normalizeSpeed.js";

function isAddr(x) {
  return typeof x === "string" && ethers.isAddress(x.trim());
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..", "..", "..");

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

function runLaneScript({ scriptName, lane, env }) {
  const scriptPath = resolveScriptPath(scriptName);
  if (!scriptPath) {
    const err = new Error(`Script not found for lane ${lane}: ${scriptName}`);
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
    `quickpay-${lane}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );

  const result = spawnSync("node", [scriptPath, "--json-out", tmpFile], {
    env,
    encoding: "utf-8",
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const exitCode = typeof result.status === "number" ? result.status : null;

  let json = null;
  if (fs.existsSync(tmpFile)) {
    const raw = fs.readFileSync(tmpFile, "utf-8");
    json = JSON.parse(raw);
  }

  if (result.error || exitCode !== 0) {
    if (json && json.needsUserOpSignature === true) {
      return { ...json, lane, ok: false };
    }
    const err = new Error(`Lane ${lane} script failed: ${stderr}`.trim());
    err.details = { stdout, stderr, exitCode };
    if (env?.QUICKPAY_DEBUG === "1") {
      err.details.scriptPath = scriptPath;
    }
    throw err;
  }

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
  userOpSignature,
  userOpDraft,
  smart,
}) {
  const { canonicalSpeed, canonicalFeeMode } = normalizeSpeed({ feeMode, speed });
  const feeModeNorm = canonicalFeeMode;
  const speedNum = canonicalSpeed;
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

  if (userOpDraft && userOpSignature) {
    console.log(
      `NORMALIZED_SPEED feeMode=${feeMode ?? ""} speedIn=${speed ?? ""} speedOut=${canonicalSpeed}`
    );
    const draftError = (code, message) => {
      const err = new Error(message);
      err.status = 400;
      err.code = code;
      return err;
    };

    const requireDraftField = (key, message) => {
      const value = userOpDraft?.[key];
      if (value == null || value === "") {
        throw draftError("DRAFT_MISSING_FIELD", message ?? `Missing draft.${key}`);
      }
      return value;
    };

    const requireDraftBigInt = (key) => {
      const raw = requireDraftField(
        key,
        `Missing draft.${key} – would cause AA33 finalFee mismatch. Re-run /quote (step-1).`
      );
      let value;
      try {
        value = BigInt(raw);
      } catch (err) {
        throw draftError("DRAFT_INVALID_FIELD", `Invalid draft.${key}: ${raw}`);
      }
      if (value <= 0n) {
        throw draftError(
          "DRAFT_INVALID_FIELD",
          `Missing draft.${key} – would cause AA33 finalFee mismatch. Re-run /quote (step-1).`
        );
      }
      return value;
    };

    const draftLane = String(requireDraftField("lane", "Missing draft.lane")).toUpperCase();
    requireDraftField("sender", "Missing draft.sender");
    requireDraftField("nonce", "Missing draft.nonce");
    requireDraftField("callData", "Missing draft.callData");
    requireDraftField("paymaster", "Missing draft.paymaster");
    requireDraftField("paymasterData", "Missing draft.paymasterData");
    requireDraftField("callGasLimit", "Missing draft.callGasLimit");
    requireDraftField("verificationGasLimit", "Missing draft.verificationGasLimit");
    requireDraftField("preVerificationGas", "Missing draft.preVerificationGas");
    requireDraftField("maxFeePerGas", "Missing draft.maxFeePerGas");
    requireDraftField("maxPriorityFeePerGas", "Missing draft.maxPriorityFeePerGas");

    const draftFeeUsd6 = requireDraftBigInt("feeUsd6");
    const draftFeeTokenAmount = requireDraftBigInt("feeTokenAmount");
    const draftMaxFeeUsd6 = requireDraftBigInt("maxFeeUsd6");
    requireDraftBigInt("baselineUsd6");
    requireDraftBigInt("surchargeUsd6");

    if (draftMaxFeeUsd6 < draftFeeUsd6) {
      throw draftError("DRAFT_INVALID_FIELD", "draft.maxFeeUsd6 must be >= draft.feeUsd6");
    }
    if (draftFeeTokenAmount <= 0n) {
      throw draftError(
        "DRAFT_INVALID_FIELD",
        "Missing draft.feeTokenAmount – would cause AA33 finalFee mismatch. Re-run /quote (step-1)."
      );
    }

    const envPaymaster = String(paymaster || process.env.PAYMASTER || "").trim();
    if (envPaymaster && String(userOpDraft?.paymaster || "").toLowerCase() !== envPaymaster.toLowerCase()) {
      throw draftError("DRAFT_MISMATCH_PAYMASTER", "draft.paymaster does not match PAYMASTER env");
    }

    const envFactory = String(factory || process.env.FACTORY || "").trim();
    if (userOpDraft?.factory && envFactory) {
      if (String(userOpDraft.factory).toLowerCase() !== envFactory.toLowerCase()) {
        throw draftError("DRAFT_MISMATCH_FACTORY", "draft.factory does not match FACTORY env");
      }
    }

    const expectedSender = smart?.sender || userOpDraft?.smartSender || null;
    if (expectedSender) {
      if (String(userOpDraft.sender).toLowerCase() !== String(expectedSender).toLowerCase()) {
        throw draftError("DRAFT_MISMATCH_SENDER", "draft.sender does not match smartSender");
      }
    }

    let scriptName;
    if (draftLane === "EIP3009") scriptName = "send_eip3009_v5.mjs";
    else if (draftLane === "PERMIT2") scriptName = "send_permit2_v5.mjs";
    else if (draftLane === "EIP2612") scriptName = "send_eip2612_v5.mjs";
    else throw new Error(`Unsupported lane for this send endpoint: ${draftLane}`);

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
      SPEED: String(speedNum),
      FEE_MODE: feeModeNorm,
      USEROP_DRAFT_JSON: JSON.stringify(userOpDraft),
      USEROP_SIGNATURE: String(userOpSignature).trim(),
    };

    return runLaneScript({ scriptName, lane: draftLane, env });
  }

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
    feeMode: feeModeNorm,
    speed: speedNum,
    permit2: process.env.PERMIT2,
    eip3009Tokens: process.env.EIP3009_TOKENS,
    eip2612Tokens: process.env.EIP2612_TOKENS,
    mode: "SPONSORED",
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

  console.log(
    `NORMALIZED_SPEED feeMode=${feeMode ?? ""} speedIn=${speed ?? ""} speedOut=${canonicalSpeed}`
  );

  const envMax = BigInt(process.env.MAX_FEE_USDC6 || process.env.MAX_FEE_USD6 || process.env.MAX_FEE_USDC || "0");
  const floor = 1000000n;
  const chosen = envMax >= floor ? envMax : floor;

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
    SPEED: String(speedNum),
    FEE_MODE: feeModeNorm,
    MAX_FEE_USDC6: chosen.toString(),
    MAX_FEE_USD6: chosen.toString(),
    FINAL_FEE_TOKEN: String(q.feeTokenAmount),
    FINAL_FEE: String(q.feeTokenAmount),
  };
  if (auth) env.AUTH_JSON = JSON.stringify(auth);
  if (userOpSignature) env.USEROP_SIGNATURE = String(userOpSignature).trim();

  return runLaneScript({ scriptName, lane: q.lane, env });
}
