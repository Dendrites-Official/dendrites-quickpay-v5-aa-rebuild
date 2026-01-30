// IMPORTANT: scripts must run from apps/quickpay-api/scripts/aa to avoid stale Railway builds.
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getQuote } from "./quote.js";
import { normalizeSpeed } from "./normalizeSpeed.js";
import { resolveRpcUrl } from "./resolveRpcUrl.js";
import { createTtlCache } from "./cache.js";
import { getOrchestratorTimeoutMs, getRpcTimeoutMs, spawnWithTimeout, withTimeout } from "./withTimeout.js";

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

async function runLaneScript({ scriptName, lane, env }) {
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

  const result = await spawnWithTimeout(
    "node",
    [scriptPath, "--json-out", tmpFile],
    { env, encoding: "utf-8" },
    getOrchestratorTimeoutMs(),
    {
      code: "ORCHESTRATOR_TIMEOUT",
      status: 504,
      where: "runLaneScript",
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

const PERMIT2_ALLOWANCE_ABI = [
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
];

const ERC20_ALLOWANCE_ABI = [
  "function allowance(address owner,address spender) view returns (uint256)",
];

const ERC20_BALANCE_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
];

const APPROVE_GAS_FALLBACK = 65000n;
const MAX_FEE_FALLBACK = 2_000_000_000n; // 2 gwei

const ALLOWANCE_TTL_MS = 15 * 1000;
const allowanceCache = createTtlCache({ ttlMs: ALLOWANCE_TTL_MS, maxSize: 10000 });

function parseList(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
  );
}

async function getAllowanceCached({ provider, token, owner, spender }) {
  const key = `${String(token).toLowerCase()}:${String(owner).toLowerCase()}:${String(spender).toLowerCase()}`;
  const cached = allowanceCache.get(key);
  if (cached != null) return cached;
  const tokenContract = new ethers.Contract(token, ERC20_ALLOWANCE_ABI, provider);
  const allowance = await withTimeout(tokenContract.allowance(owner, spender), getRpcTimeoutMs(), {
    code: "RPC_TIMEOUT",
    status: 504,
    where: "sendSponsored.allowance",
    message: "RPC timeout",
  });
  allowanceCache.set(key, allowance);
  return allowance;
}

async function estimateApproveCost({ provider, owner, token, spender }) {
  try {
    const erc20 = new ethers.Contract(token, ["function approve(address spender,uint256 value)"], provider);
    const gas = await withTimeout(erc20.approve.estimateGas(spender, ethers.MaxUint256, { from: owner }), getRpcTimeoutMs(), {
      code: "RPC_TIMEOUT",
      status: 504,
      where: "sendSponsored.estimateApproveGas",
      message: "RPC timeout",
    });
    const feeData = await withTimeout(provider.getFeeData(), getRpcTimeoutMs(), {
      code: "RPC_TIMEOUT",
      status: 504,
      where: "sendSponsored.getFeeData",
      message: "RPC timeout",
    });
    const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? MAX_FEE_FALLBACK;
    return BigInt(gas) * BigInt(maxFeePerGas);
  } catch {
    return APPROVE_GAS_FALLBACK * MAX_FEE_FALLBACK;
  }
}

async function maybeNeedsApprove({
  provider,
  owner,
  token,
  permit2Addr,
  amount,
  funderPk,
}) {
  const erc20Allowance = await getAllowanceCached({ provider, token, owner, spender: permit2Addr });
  if (BigInt(erc20Allowance ?? 0n) >= BigInt(amount)) return null;

  const balContract = new ethers.Contract(token, ERC20_BALANCE_ABI, provider);
  const ownerBal = await withTimeout(balContract.balanceOf(owner), getRpcTimeoutMs(), {
    code: "RPC_TIMEOUT",
    status: 504,
    where: "sendSponsored.balanceOf",
    message: "RPC timeout",
  });
  if (BigInt(ownerBal ?? 0n) < BigInt(amount)) {
    const err = new Error("INSUFFICIENT_TOKEN_BALANCE");
    err.status = 400;
    err.code = "BALANCE_TOO_LOW";
    err.details = { required: String(amount), balance: String(ownerBal ?? "0") };
    throw err;
  }

  const ethBal = await withTimeout(provider.getBalance(owner), getRpcTimeoutMs(), {
    code: "RPC_TIMEOUT",
    status: 504,
    where: "sendSponsored.getBalance",
    message: "RPC timeout",
  });
  const ethNeeded = await estimateApproveCost({
    provider,
    owner,
    token,
    spender: permit2Addr,
  });
  let stipendTxHash = null;
  if (ethBal < ethNeeded) {
    if (!funderPk) {
      const err = new Error("Missing stipend funder key");
      err.status = 400;
      err.code = "MISSING_STIPEND_FUNDER_KEY";
      throw err;
    }

    const stipendWei = BigInt(process.env.STIPEND_WEI || "120000000000000");
    const funder = new ethers.Wallet(funderPk, provider);
    const stipendTx = await withTimeout(funder.sendTransaction({ to: owner, value: stipendWei }), getRpcTimeoutMs(), {
      code: "RPC_TIMEOUT",
      status: 504,
      where: "sendSponsored.stipendSend",
      message: "RPC timeout",
    });
    await withTimeout(stipendTx.wait(1), getRpcTimeoutMs(), {
      code: "RPC_TIMEOUT",
      status: 504,
      where: "sendSponsored.stipendWait",
      message: "RPC timeout",
    });
    stipendTxHash = stipendTx.hash;
  }

  const approveIface = new ethers.Interface([
    "function approve(address spender,uint256 value) returns (bool)",
  ]);
  const approveData = approveIface.encodeFunctionData("approve", [permit2Addr, ethers.MaxUint256]);

  return {
    ok: false,
    code: "NEEDS_APPROVE",
    setupNeeded: ["permit2_allowance_missing"],
    approve: {
      token,
      spender: permit2Addr,
      amount: ethers.MaxUint256.toString(),
      to: token,
      data: approveData,
    },
    stipendTxHash,
    next: { endpoint: "/send", requires: "approveConfirmed" },
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
  logger,
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

  const resolvedRpc = await resolveRpcUrl({ rpcUrl: rpc, bundlerUrl, chainId });
  const provider = new ethers.JsonRpcProvider(resolvedRpc);

  const permit2Addr = String(process.env.PERMIT2 || "").trim();
  const funderPk = String(
    process.env.STIPEND_FUNDER_PRIVATE_KEY || process.env.TESTNET_RELAYER_PRIVATE_KEY || ""
  ).trim();
  const eip3009Set = parseList(process.env.EIP3009_TOKENS);
  const eip2612Set = parseList(process.env.EIP2612_TOKENS);
  const tokenLower = tokenAddr.toLowerCase();
  const lane = eip3009Set.has(tokenLower) ? "EIP3009" : eip2612Set.has(tokenLower) ? "EIP2612" : "PERMIT2";

  if (lane === "PERMIT2" && permit2Addr && ethers.isAddress(permit2Addr)) {
    const preflight = await maybeNeedsApprove({
      provider,
      owner,
      token: tokenAddr,
      permit2Addr,
      amount: amt,
      funderPk,
    });
    if (preflight) {
      return preflight;
    }
  }

  if (userOpDraft && userOpSignature) {
    logger?.info?.("NORMALIZED_SPEED", {
      feeMode: feeMode ?? "",
      speedIn: speed ?? "",
      speedOut: canonicalSpeed,
    });
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

    if (draftLane === "PERMIT2") {
      if (!permit2Addr || !ethers.isAddress(permit2Addr)) {
        throw new Error("Missing PERMIT2 env address");
      }
      const preflight = await maybeNeedsApprove({
        provider,
        owner,
        token: tokenAddr,
        permit2Addr,
        amount: amt,
        funderPk,
      });
      if (preflight) {
        return preflight;
      }
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
      PERMIT2: process.env.PERMIT2,
      TOKEN: tokenAddr,
      TO: toAddr,
      AMOUNT: amt,
      OWNER_EOA: owner,
      SPEED: String(speedNum),
      FEE_MODE: feeModeNorm,
      FINAL_FEE_TOKEN: String(userOpDraft?.feeTokenAmount ?? ""),
      FINAL_FEE: String(userOpDraft?.feeTokenAmount ?? ""),
      MAX_FEE_USDC6: String(userOpDraft?.maxFeeUsd6 ?? ""),
      MAX_FEE_USD6: String(userOpDraft?.maxFeeUsd6 ?? ""),
      USEROP_DRAFT_JSON: JSON.stringify(userOpDraft),
      USEROP_SIGNATURE: String(userOpSignature).trim(),
    };
    if (auth) env.AUTH_JSON = JSON.stringify(auth);

    return await runLaneScript({ scriptName, lane: draftLane, env });
  }

  const q = await getQuote({
    chainId,
    rpcUrl: resolvedRpc,
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
    logger,
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

  if (q.lane === "PERMIT2") {
    if (!permit2Addr || !ethers.isAddress(permit2Addr)) {
      throw new Error("Missing PERMIT2 env address");
    }
    const preflight = await maybeNeedsApprove({
      provider,
      owner,
      token: tokenAddr,
      permit2Addr,
      amount: amt,
      funderPk,
    });
    if (preflight) {
      return preflight;
    }
  }

  let scriptName;
  if (q.lane === "EIP3009") scriptName = "send_eip3009_v5.mjs";
  else if (q.lane === "PERMIT2") scriptName = "send_permit2_v5.mjs";
  else if (q.lane === "EIP2612") scriptName = "send_eip2612_v5.mjs";
  else throw new Error(`Unsupported lane for this send endpoint: ${q.lane}`);

  logger?.info?.("NORMALIZED_SPEED", {
    feeMode: feeMode ?? "",
    speedIn: speed ?? "",
    speedOut: canonicalSpeed,
  });

  const envMax = BigInt(process.env.MAX_FEE_USDC6 || process.env.MAX_FEE_USD6 || process.env.MAX_FEE_USDC || "0");
  const floor = 1000000n;
  const chosen = envMax >= floor ? envMax : floor;

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

  return await runLaneScript({ scriptName, lane: q.lane, env });
}
