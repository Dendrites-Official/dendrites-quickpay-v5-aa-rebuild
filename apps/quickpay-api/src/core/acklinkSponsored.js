import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getOrchestratorTimeoutMs, spawnWithTimeout } from "./withTimeout.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        __dirname,
      };
    }
    throw err;
  }

  const tmpDir = "/tmp";
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(
    tmpDir,
    `acklink-${lane}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );

  const result = await spawnWithTimeout(
    "node",
    [scriptPath, "--json-out", tmpFile],
    { env, encoding: "utf-8" },
    getOrchestratorTimeoutMs(),
    {
      code: "ORCHESTRATOR_TIMEOUT",
      status: 504,
      where: "acklink.runLaneScript",
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
    userOpHash: json?.userOpHash ?? json?.userOp?.userOpHash ?? null,
    txHash: json?.txHash ?? json?.transactionHash ?? null,
    needsUserOpSignature: json?.needsUserOpSignature ?? false,
    userOpDraft: json?.userOpDraft ?? null,
  };
}

export async function sendAcklinkSponsored({
  action,
  chainId,
  rpcUrl,
  bundlerUrl,
  ownerEoa,
  speed,
  amountUsdc6,
  feeUsdc6,
  expiresAt,
  metaHash,
  auth,
  linkId,
  claimTo,
  userOpSignature,
  userOpDraft,
}) {
  const paymaster = String(process.env.ACKLINK_PAYMASTER || process.env.PAYMASTER || "").trim();
  const factory = String(process.env.FACTORY || "").trim();
  const entryPoint = String(process.env.ENTRYPOINT || "").trim();
  const usdc = String(process.env.USDC || "").trim();
  const feeVault = String(process.env.FEEVAULT || "").trim();
  const acklinkVault = String(process.env.ACKLINK_VAULT || "").trim();

  const env = {
    ...process.env,
    RPC_URL: rpcUrl,
    BUNDLER_URL: bundlerUrl,
    CHAIN_ID: String(chainId),
    ENTRYPOINT: entryPoint,
    PAYMASTER: paymaster,
    FACTORY: factory,
    OWNER_EOA: ownerEoa,
    USDC: usdc,
    FEEVAULT: feeVault,
    ACKLINK_VAULT: acklinkVault,
    ACTION: action,
    SPEED: String(speed ?? 0),
  };

  if (action === "CREATE") {
    env.AMOUNT = String(amountUsdc6);
    env.FEE_USDC6 = String(feeUsdc6);
    env.EXPIRES_AT = String(expiresAt);
    env.META_HASH = String(metaHash);
    if (auth) {
      env.AUTH_FROM = String(auth.from);
      env.AUTH_VALUE = String(auth.value);
      env.AUTH_VALID_AFTER = String(auth.validAfter);
      env.AUTH_VALID_BEFORE = String(auth.validBefore);
      env.AUTH_NONCE = String(auth.nonce);
      env.AUTH_V = String(auth.v);
      env.AUTH_R = String(auth.r);
      env.AUTH_S = String(auth.s);
    }
  } else if (action === "CLAIM") {
    env.LINK_ID = String(linkId);
    env.CLAIM_TO = String(claimTo);
  } else if (action === "REFUND") {
    env.LINK_ID = String(linkId);
  }

  if (userOpSignature) {
    env.USEROP_SIGNATURE = String(userOpSignature);
  }
  if (userOpDraft) {
    env.USEROP_DRAFT_JSON = JSON.stringify(userOpDraft);
  }

  const result = await runLaneScript({ scriptName: "acklink_v5.mjs", lane: "ACKLINK", env });
  if (result?.needsUserOpSignature === true) {
    return result;
  }

  return result;
}
