import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { createClient } from "@supabase/supabase-js";
import { Contract, JsonRpcProvider, isAddress } from "ethers";
import crypto from "node:crypto";
import { getQuote } from "./core/quote.js";
import { resolveSmartAccount } from "./core/smartAccount.js";
import { sendSponsored } from "./core/sendSponsored.js";
import { sendBulkSponsored } from "./core/sendBulkSponsored.js";
import { sendSelfPay } from "./core/sendSelfPay.js";
import { normalizeAddress } from "./core/normalizeAddress.js";
import { resolveRpcUrl } from "./core/resolveRpcUrl.js";
import { createLogger } from "./core/logging.js";
import { createTtlCache } from "./core/cache.js";
import { getBundlerTimeoutMs, getRpcTimeoutMs, withTimeout } from "./core/withTimeout.js";
import { registerFaucetRoutes } from "./routes/faucet.js";
import { registerWalletRoutes } from "./routes/wallet.js";

const app = Fastify({ logger: true });

function getEnv(name, aliases = []) {
  const direct = process.env[name];
  if (direct != null && direct !== "") return direct;
  for (const alias of aliases) {
    const value = process.env[alias];
    if (value != null && value !== "") return value;
  }
  return "";
}

const RATE_LIMIT_WINDOW_SEC = Number(process.env.RATE_LIMIT_WINDOW_SEC ?? 60);
const RATE_LIMIT_IP = Number(process.env.RATE_LIMIT_IP ?? 120);
const RATE_LIMIT_WALLET = Number(process.env.RATE_LIMIT_WALLET ?? 60);
const RATE_LIMIT_BULK_IP = Number(process.env.RATE_LIMIT_BULK_IP ?? 30);
const RATE_LIMIT_BULK_WALLET = Number(process.env.RATE_LIMIT_BULK_WALLET ?? 10);
const rateLimitStore = new Map();

function getRateLimitEntry(key, windowMs) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || now > entry.resetAt) {
    const fresh = { count: 0, resetAt: now + windowMs };
    rateLimitStore.set(key, fresh);
    return fresh;
  }
  return entry;
}

function checkRateLimit(key, limit, windowMs) {
  const entry = getRateLimitEntry(key, windowMs);
  entry.count += 1;
  const remaining = limit - entry.count;
  if (remaining >= 0) return { allowed: true };
  const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
  return { allowed: false, retryAfterSec };
}

function enforceRateLimit(request, reply, walletAddress) {
  const windowMs = Math.max(1, RATE_LIMIT_WINDOW_SEC) * 1000;
  const ip = getClientIp(request) || "unknown";
  const ipCheck = checkRateLimit(`ip:${ip}`, RATE_LIMIT_IP, windowMs);
  if (!ipCheck.allowed) {
    return reply.code(429).send({
      ok: false,
      code: "RATE_LIMITED",
      retryAfterSec: ipCheck.retryAfterSec,
    });
  }

  if (walletAddress && isAddress(walletAddress)) {
    const walletKey = `wallet:${String(walletAddress).toLowerCase()}`;
    const walletCheck = checkRateLimit(walletKey, RATE_LIMIT_WALLET, windowMs);
    if (!walletCheck.allowed) {
      return reply.code(429).send({
        ok: false,
        code: "RATE_LIMITED",
        retryAfterSec: walletCheck.retryAfterSec,
      });
    }
  }
  return null;
}

function enforceBulkRateLimit(request, reply, walletAddress) {
  const windowMs = Math.max(1, RATE_LIMIT_WINDOW_SEC) * 1000;
  const ip = getClientIp(request) || "unknown";
  const ipCheck = checkRateLimit(`bulk:ip:${ip}`, RATE_LIMIT_BULK_IP, windowMs);
  if (!ipCheck.allowed) {
    return reply.code(429).send({
      ok: false,
      code: "RATE_LIMITED",
      retryAfterSec: ipCheck.retryAfterSec,
    });
  }

  if (walletAddress && isAddress(walletAddress)) {
    const walletKey = `bulk:wallet:${String(walletAddress).toLowerCase()}`;
    const walletCheck = checkRateLimit(walletKey, RATE_LIMIT_BULK_WALLET, windowMs);
    if (!walletCheck.allowed) {
      return reply.code(429).send({
        ok: false,
        code: "RATE_LIMITED",
        retryAfterSec: walletCheck.retryAfterSec,
      });
    }
  }
  return null;
}

app.addHook("onRequest", async (request, reply) => {
  const incoming = String(request?.headers?.["x-request-id"] || "").trim();
  request.reqId = incoming || crypto.randomUUID();
  request.startTimeMs = Date.now();
  reply.header("x-request-id", request.reqId);
});

function adminUnauthorized(reply, reqId) {
  reply.header("WWW-Authenticate", "Basic realm=\"Admin\"");
  return reply.code(401).send({ ok: false, reqId, code: "UNAUTHORIZED" });
}

app.addHook("onRequest", async (request, reply) => {
  const url = String(request?.url || "");
  if (!url.startsWith("/admin")) return;

  const adminUser = String(process.env.ADMIN_USER || "").trim();
  const adminPass = String(process.env.ADMIN_PASS || "").trim();
  if (!adminUser || !adminPass) {
    return adminUnauthorized(reply, request?.reqId);
  }

  const authHeader = String(request?.headers?.authorization || "").trim();
  if (!authHeader.startsWith("Basic ")) {
    return adminUnauthorized(reply, request?.reqId);
  }

  let decoded = "";
  try {
    decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
  } catch {
    return adminUnauthorized(reply, request?.reqId);
  }

  const separator = decoded.indexOf(":");
  const providedUser = separator >= 0 ? decoded.slice(0, separator) : "";
  const providedPass = separator >= 0 ? decoded.slice(separator + 1) : "";
  if (providedUser !== adminUser || providedPass !== adminPass) {
    return adminUnauthorized(reply, request?.reqId);
  }
});

app.addHook("preHandler", async (request) => {
  request.telemetryBody = request.body ?? null;
});

app.addHook("onSend", async (request, _reply, payload) => {
  request.telemetryPayload = payload;
  return payload;
});

app.addHook("onResponse", async (request, reply) => {
  if (!supabaseUrl || !supabaseServiceRole) return;
  const route = request?.routerPath || request?.url || "";
  if (!route || (!route.startsWith("/quote") && !route.startsWith("/send") && !route.startsWith("/receipt"))) {
    return;
  }
  const latencyMs = Math.max(0, Date.now() - (request.startTimeMs || Date.now()));
  let responseData = null;
  const payload = request.telemetryPayload;
  if (typeof payload === "string") {
    try {
      responseData = JSON.parse(payload);
    } catch {
      responseData = null;
    }
  } else if (payload && typeof payload === "object") {
    responseData = payload;
  }

  const body = request.telemetryBody && typeof request.telemetryBody === "object" ? request.telemetryBody : {};
  const wallet = body.ownerEoa || body.owner || body.sender || null;
  const token = body.token || null;
  const speed = body.speed || body.feeMode || null;
  const lane = responseData?.lane ?? null;
  const errorCode = responseData?.code ?? null;
  const ip = getClientIp(request);
  const salt = String(process.env.IP_HASH_SALT || "");
  const ipHash = salt && ip ? sha256Hex(`${salt}:${ip}`) : null;

  await logRequestTelemetry({
    req_id: request.reqId,
    source: "quickpay-api",
    route,
    ok: reply.statusCode < 400,
    status_code: reply.statusCode,
    latency_ms: latencyMs,
    error_code: errorCode,
    ip_hash: ipHash,
    wallet: wallet ? String(wallet).toLowerCase() : null,
    token: token ? String(token).toLowerCase() : null,
    speed: speed ? String(speed).toLowerCase() : null,
    lane: lane ? String(lane).toLowerCase() : null,
    meta: {},
  });
});

app.setErrorHandler((err, request, reply) => {
  const status = err?.status || 500;
  const message = redactString(err?.message || "Internal error");
  const stack = redactString(String(err?.stack || err || ""));
  const route = request?.routerPath || request?.url || "";
  if (request?.reqId) {
    logErrorTelemetry({
      req_id: request.reqId,
      source: "quickpay-api",
      route,
      error_code: err?.code || "INTERNAL",
      message_redacted: message,
      stack_redacted: stack,
      meta: {},
    });
  }
  reply.code(status).send({
    ok: false,
    reqId: request?.reqId,
    error: err?.message || "Internal error",
    code: err?.code || "INTERNAL",
    where: err?.where,
    details: process.env.NODE_ENV === "production" ? undefined : String(err?.stack || err),
  });
});

const corsOrigins = String(process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const allowedOrigins = corsOrigins.length
  ? corsOrigins
  : [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://dendrites-testnet-ui.vercel.app",
    ];

await app.register(cors, {
  origin: allowedOrigins,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
  optionsSuccessStatus: 204,
});

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseServiceRole);

function redactString(value) {
  if (!value) return value;
  return String(value)
    .replace(/0x[a-fA-F0-9]{64,}/g, "[REDACTED]")
    .replace(/(private|secret|signature|auth)[^\s]*/gi, "[REDACTED]");
}

async function logRequestTelemetry(payload) {
  if (!supabaseUrl || !supabaseServiceRole) return;
  try {
    await supabase.from("qp_requests").insert(payload);
  } catch {
    // ignore telemetry failures
  }
}

async function logErrorTelemetry(payload) {
  if (!supabaseUrl || !supabaseServiceRole) return;
  try {
    await supabase.from("qp_errors").insert(payload);
  } catch {
    // ignore telemetry failures
  }
}

function generateReceiptId() {
  const suffix = crypto.randomBytes(6).toString("hex");
  return `r_${suffix}`;
}

async function createBulkReceiptRecord({
  chainId,
  receiptId,
  ownerEoa,
  sender,
  token,
  amountRaw,
  netAmountRaw,
  feeAmountRaw,
  feeMode,
  referenceId,
  name,
  message,
  reason,
  recipients,
  modeUsed,
  speed,
  totalEntered,
  totalDebited,
}) {
  if (!supabaseUrl || !supabaseServiceRole) return null;
  const payload = {
    chain_id: chainId,
    receipt_id: receiptId,
    status: "created",
    sender: sender ? String(sender).toLowerCase() : null,
    owner_eoa: ownerEoa ? String(ownerEoa).toLowerCase() : null,
    token,
    amount_raw: amountRaw,
    net_amount_raw: netAmountRaw,
    fee_amount_raw: feeAmountRaw,
    fee_mode: feeMode,
    fee_token_mode: "same",
    title: message || null,
    display_name: name || null,
    reason: reason || null,
    reference_id: referenceId || null,
    recipients_count: Array.isArray(recipients) ? recipients.length : null,
    meta: {
      route: "sendBulk",
      speed: speed ?? null,
      modeUsed,
      totalEntered: totalEntered ?? null,
      totalDebited: totalDebited ?? null,
      feeAmount: feeAmountRaw ?? null,
      recipients: Array.isArray(recipients) ? recipients : [],
    },
  };

  const { error } = await supabase.from("quickpay_receipts").insert(payload);
  if (error) throw error;
  return receiptId;
}

async function callQuickpayReceipt(payload, { reqId } = {}) {
  const baseUrl = String(supabaseUrl || "").trim();
  if (!baseUrl || !supabaseServiceRole) return null;
  const url = `${baseUrl.replace(/\/+$/, "")}/functions/v1/quickpay_receipt`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": reqId || crypto.randomUUID(),
        apikey: supabaseServiceRole,
        Authorization: `Bearer ${supabaseServiceRole}`,
      },
      body: JSON.stringify(payload ?? {}),
    });
    const data = await res.json().catch(() => null);
    return data ?? null;
  } catch {
    return null;
  }
}

async function callQuickpayNote({ receiptId, sender, note, signature, chainId, reqId }) {
  const baseUrl = String(supabaseUrl || "").trim();
  if (!baseUrl || !supabaseServiceRole) return null;
  if (!receiptId || !sender || !note || !signature) return null;
  const url = `${baseUrl.replace(/\/+$/, "")}/functions/v1/quickpay_note`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": reqId || crypto.randomUUID(),
        apikey: supabaseServiceRole,
        Authorization: `Bearer ${supabaseServiceRole}`,
      },
      body: JSON.stringify({ receiptId, sender, note, signature, chainId }),
    });
    const data = await res.json().catch(() => null);
    return data ?? null;
  } catch {
    return null;
  }
}

async function recordSponsorshipCost({ reqId, route, txHash, userOpHash, chainId, meta }) {
  if (!supabaseUrl || !supabaseServiceRole || !txHash) return null;
  const rpcUrl = String(process.env.RPC_URL || "").trim();
  if (!rpcUrl) return null;
  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const receipt = await withTimeout(provider.getTransactionReceipt(txHash), getRpcTimeoutMs(), {
      code: "RPC_TIMEOUT",
      status: 504,
      where: "sponsorshipCost.receipt",
      message: "RPC timeout",
    });
    if (!receipt) return;
    const gasUsed = receipt.gasUsed != null ? BigInt(receipt.gasUsed) : null;
    const gasPrice = receipt.effectiveGasPrice != null ? BigInt(receipt.effectiveGasPrice) : null;
    const ethCostWei = gasUsed != null && gasPrice != null ? gasUsed * gasPrice : null;
    await supabase.from("qp_sponsorship_costs").insert({
      chain_id: chainId ?? Number(process.env.CHAIN_ID ?? 84532),
      req_id: reqId ?? null,
      route,
      tx_hash: txHash ?? null,
      user_op_hash: userOpHash ?? null,
      gas_used: gasUsed != null ? gasUsed.toString() : null,
      effective_gas_price_wei: gasPrice != null ? gasPrice.toString() : null,
      eth_cost_wei: ethCostWei != null ? ethCostWei.toString() : null,
      meta: meta ?? null,
    });
    return ethCostWei != null ? ethCostWei.toString() : null;
  } catch {
    return null;
  }
}

function getClientIp(request) {
  const forwarded = String(request?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  if (forwarded) return forwarded;
  return String(request?.ip || "");
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function runSnapshot({ reqId, logger }) {
  const chainId = Number(process.env.CHAIN_ID ?? 84532);
  const rpcUrl = String(process.env.RPC_URL || "").trim();
  const bundlerUrl = String(process.env.BUNDLER_URL || "").trim();
  const entryPoint = String(process.env.ENTRYPOINT || "").trim();
  const paymaster = String(process.env.PAYMASTER || "").trim();
  const feeVault = String(process.env.FEEVAULT || "").trim();

  if (!rpcUrl) {
    return { ok: false, reqId, code: "RPC_URL_MISSING", status: 500 };
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const ts = new Date().toISOString();

  let rpc_ok = false;
  let bundler_ok = false;
  let paymaster_deposit_wei = null;
  const fee_vault_balances = {};
  let sponsorship_24h = null;

  try {
    const network = await withTimeout(provider.getNetwork(), getRpcTimeoutMs(), {
      code: "RPC_TIMEOUT",
      status: 504,
      where: "snapshot.getNetwork",
      message: "RPC timeout",
    });
    rpc_ok = Number(network?.chainId) === chainId;
  } catch (err) {
    rpc_ok = false;
  }

  if (bundlerUrl && entryPoint) {
    try {
      const res = await withTimeout(
        fetch(bundlerUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "eth_supportedEntryPoints", params: [] }),
        }),
        getBundlerTimeoutMs(),
        { code: "BUNDLER_TIMEOUT", status: 504, where: "snapshot.bundler", message: "Bundler timeout" }
      );
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const entries = Array.isArray(data?.result) ? data.result : [];
        const normalized = entries.map((entry) => String(entry).toLowerCase());
        bundler_ok = normalized.includes(String(entryPoint).toLowerCase());
      }
    } catch {
      bundler_ok = false;
    }
  }

  if (entryPoint && paymaster && isAddress(entryPoint) && isAddress(paymaster)) {
    try {
      const entryAbi = ["function balanceOf(address) view returns (uint256)"];
      const contract = new Contract(entryPoint, entryAbi, provider);
      const deposit = await withTimeout(contract.balanceOf(paymaster), getRpcTimeoutMs(), {
        code: "RPC_TIMEOUT",
        status: 504,
        where: "snapshot.paymasterDeposit",
        message: "RPC timeout",
      });
      paymaster_deposit_wei = String(deposit ?? "0");
    } catch {
      paymaster_deposit_wei = null;
    }
  }

  const alertRaw = String(process.env.ALERT_LOW_DEPOSIT_WEI || "").trim();
  const alertMin = alertRaw && /^\d+$/.test(alertRaw) ? BigInt(alertRaw) : null;
  if (alertMin != null && paymaster_deposit_wei != null) {
    try {
      const current = BigInt(paymaster_deposit_wei || "0");
      if (current < alertMin) {
        logger.warn("ALERT_LOW_DEPOSIT", {
          paymaster_deposit_wei,
          alert_below_wei: String(alertMin),
          chainId,
        });
      }
    } catch {
      // ignore alert parsing
    }
  }

  if (feeVault && isAddress(feeVault)) {
    const tokens = String(process.env.SNAPSHOT_TOKENS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const erc20Abi = ["function balanceOf(address owner) view returns (uint256)"];
    for (const token of tokens) {
      if (!isAddress(token)) continue;
      try {
        const contract = new Contract(token, erc20Abi, provider);
        const bal = await withTimeout(contract.balanceOf(feeVault), getRpcTimeoutMs(), {
          code: "RPC_TIMEOUT",
          status: 504,
          where: "snapshot.feeVaultBalance",
          message: "RPC timeout",
        });
        fee_vault_balances[token.toLowerCase()] = String(bal ?? "0");
      } catch {
        fee_vault_balances[token.toLowerCase()] = null;
      }
    }
  }

  if (supabaseUrl && supabaseServiceRole) {
    try {
      const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, count, error } = await supabase
        .from("qp_sponsorship_costs")
        .select("eth_cost_wei", { count: "exact" })
        .gte("created_at", sinceIso);
      if (!error && Array.isArray(data)) {
        let sum = 0n;
        for (const row of data) {
          const raw = row?.eth_cost_wei;
          if (raw != null) {
            try {
              sum += BigInt(raw);
            } catch {
              // ignore parse errors
            }
          }
        }
        sponsorship_24h = {
          count: typeof count === "number" ? count : data.length,
          eth_cost_wei: sum.toString(),
        };
      }
    } catch {
      sponsorship_24h = null;
    }

    await supabase.from("qp_chain_snapshots").insert({
      chain_id: chainId,
      rpc_ok,
      bundler_ok,
      paymaster_deposit_wei,
      fee_vault_balances,
      meta: {
        sponsorship_24h: sponsorship_24h ?? null,
      },
    });
  }

  return {
    ok: true,
    ts,
    chainId,
    rpc_ok,
    bundler_ok,
    paymaster_deposit_wei,
    fee_vault_balances,
    sponsorship_24h,
    reqId,
  };
}

registerFaucetRoutes(app);
registerWalletRoutes(app);

const codeCache = createTtlCache({ ttlMs: 10 * 60 * 1000, maxSize: 2000 });

async function getCodeExists(provider, address) {
  const key = String(address || "").toLowerCase();
  const cached = codeCache.get(key);
  if (cached != null) return cached;
  const code = await withTimeout(provider.getCode(address), getRpcTimeoutMs(), {
    code: "RPC_TIMEOUT",
    status: 504,
    where: "doctor.getCode",
    message: "RPC timeout",
  });
  const exists = typeof code === "string" && code !== "0x";
  codeCache.set(key, exists);
  return exists;
}

app.get("/health", async () => ({
  ok: true,
  build: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.BUILD_ID || new Date().toISOString(),
}));

app.get("/doctor", async (request, reply) => {
  const reqId = request?.reqId;
  const logger = createLogger({ reqId });
  const checks = [];
  let overall = "ok";

  const setCheck = (name, status, info, ms) => {
    checks.push({ name, ok: status === "ok", ms, ...(info ? { info } : {}) });
    if (status === "down") overall = "down";
    else if (status === "degraded" && overall !== "down") overall = "degraded";
  };

  const chain = Number(process.env.CHAIN_ID ?? 84532);
  let provider = null;
  let resolvedRpcUrl = null;

  const rpcStart = Date.now();
  try {
    resolvedRpcUrl = await resolveRpcUrl({
      rpcUrl: process.env.RPC_URL,
      bundlerUrl: process.env.BUNDLER_URL,
      chainId: chain,
    });
    provider = new JsonRpcProvider(resolvedRpcUrl);
    const network = await withTimeout(provider.getNetwork(), getRpcTimeoutMs(), {
      code: "RPC_TIMEOUT",
      status: 504,
      where: "doctor.getNetwork",
      message: "RPC timeout",
    });
    setCheck("rpc", "ok", { chainId: Number(network?.chainId) }, Date.now() - rpcStart);
  } catch (err) {
    logger.error("DOCTOR_RPC_FAIL", { error: err?.message || String(err) });
    setCheck("rpc", "down", { error: err?.message || String(err) }, Date.now() - rpcStart);
  }

  const bundlerStart = Date.now();
  const bundlerUrl = String(process.env.BUNDLER_URL || "").trim();
  const entrypointEnv = String(process.env.ENTRYPOINT || "").trim().toLowerCase();
  if (!bundlerUrl) {
    setCheck("bundler", "degraded", { error: "BUNDLER_URL missing" }, Date.now() - bundlerStart);
  } else {
    try {
      const res = await withTimeout(
        fetch(bundlerUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "eth_supportedEntryPoints", params: [] }),
        }),
        getBundlerTimeoutMs(),
        { code: "BUNDLER_TIMEOUT", status: 504, where: "doctor.bundler", message: "Bundler timeout" }
      );
      if (!res.ok) {
        throw new Error(`BUNDLER_HTTP_${res.status}`);
      }
      const data = await res.json().catch(() => ({}));
      const entries = Array.isArray(data?.result) ? data.result : [];
      const normalized = entries.map((entry) => String(entry).toLowerCase());
      const hasEntryPoint = entrypointEnv ? normalized.includes(entrypointEnv) : false;
      setCheck(
        "bundler",
        hasEntryPoint ? "ok" : "degraded",
        { supportedEntryPoints: entries, entryPoint: entrypointEnv || null },
        Date.now() - bundlerStart
      );
    } catch (err) {
      setCheck("bundler", "down", { error: err?.message || String(err) }, Date.now() - bundlerStart);
    }
  }

  const bytecodeStart = Date.now();
  if (!provider) {
    setCheck("bytecode", "down", { error: "RPC unavailable" }, Date.now() - bytecodeStart);
  } else {
    const addresses = {
      router: process.env.ROUTER,
      paymaster: process.env.PAYMASTER,
      factory: process.env.FACTORY,
      feeVault: process.env.FEEVAULT,
      permit2: process.env.PERMIT2,
      usdc: process.env.USDC,
    };
    const details = {};
    let status = "ok";
    for (const [name, value] of Object.entries(addresses)) {
      const addr = String(value || "").trim();
      if (!addr || !isAddress(addr)) {
        details[name] = { ok: false, error: "missing_or_invalid" };
        status = status === "down" ? status : "degraded";
        continue;
      }
      try {
        const exists = await getCodeExists(provider, addr);
        details[name] = { ok: exists };
        if (!exists) status = status === "down" ? status : "degraded";
      } catch (err) {
        details[name] = { ok: false, error: err?.message || String(err) };
        status = "down";
      }
    }
    setCheck("bytecode", status, details, Date.now() - bytecodeStart);
  }

  const depositStart = Date.now();
  if (!provider) {
    setCheck("paymasterDeposit", "down", { error: "RPC unavailable" }, Date.now() - depositStart);
  } else {
    const paymaster = String(process.env.PAYMASTER || "").trim();
    const entryPoint = String(process.env.ENTRYPOINT || "").trim();
    if (!paymaster || !entryPoint || !isAddress(paymaster) || !isAddress(entryPoint)) {
      setCheck("paymasterDeposit", "degraded", { error: "missing_or_invalid" }, Date.now() - depositStart);
    } else {
      try {
        const entryAbi = ["function balanceOf(address) view returns (uint256)"];
        const contract = new Contract(entryPoint, entryAbi, provider);
        const deposit = await withTimeout(contract.balanceOf(paymaster), getRpcTimeoutMs(), {
          code: "RPC_TIMEOUT",
          status: 504,
          where: "doctor.paymasterDeposit",
          message: "RPC timeout",
        });
        const minRaw = String(process.env.PAYMASTER_DEPOSIT_WARN_WEI || "").trim();
        const min = minRaw && /^\d+$/.test(minRaw) ? BigInt(minRaw) : null;
        const warn = min != null && BigInt(deposit ?? 0n) < min;
        setCheck(
          "paymasterDeposit",
          warn ? "degraded" : "ok",
          { deposit: String(deposit ?? "0"), warnBelow: min ? String(min) : null },
          Date.now() - depositStart
        );
      } catch (err) {
        setCheck("paymasterDeposit", "down", { error: err?.message || String(err) }, Date.now() - depositStart);
      }
    }
  }

  return reply.send({ ok: overall === "ok", status: overall, checks, reqId });
});

app.post("/admin/snapshot", async (request, reply) => {
  const reqId = request?.reqId;
  const logger = createLogger({ reqId });
  const adminKey = String(process.env.ADMIN_KEY || "").trim();
  if (!adminKey) {
    return reply.code(500).send({ ok: false, reqId, code: "ADMIN_KEY_MISSING" });
  }
  const snapshot = await runSnapshot({ reqId, logger });
  if (snapshot?.ok === false) {
    return reply.code(snapshot.status || 500).send(snapshot);
  }
  return reply.send(snapshot);
});

app.post("/admin/snapshot/run", async (request, reply) => {
  const reqId = request?.reqId;
  const logger = createLogger({ reqId });
  const adminKey = String(process.env.ADMIN_KEY || "").trim();
  if (!adminKey) {
    return reply.code(500).send({ ok: false, reqId, code: "ADMIN_KEY_MISSING" });
  }

  const snapshot = await runSnapshot({ reqId, logger });
  if (snapshot?.ok === false) {
    return reply.code(snapshot.status || 500).send(snapshot);
  }
  return reply.send(snapshot);
});

app.post("/events/log", async (request, reply) => {
  const reqId = request?.reqId;
  const body = request.body ?? {};
  const kind = String(body?.kind || "").trim();
  if (!kind) {
    return reply.send({ ok: false, reqId, error: "missing_kind" });
  }

  if (!supabaseUrl || !supabaseServiceRole) {
    return reply.send({ ok: true, reqId, skipped: true, reason: "DB_NOT_CONFIGURED" });
  }

  const salt = String(process.env.IP_HASH_SALT || "");

  const address = body?.address ? String(body.address).trim().toLowerCase() : null;
  const chainId = body?.chainId != null ? Number(body.chainId) : null;
  const meta = body?.meta && typeof body.meta === "object" ? body.meta : null;
  const ip = getClientIp(request);
  const ua = String(request?.headers?.["user-agent"] || "");
  const ipHash = salt && ip ? sha256Hex(`${salt}:${ip}`) : null;
  const uaHash = salt && ua ? sha256Hex(`${salt}:${ua}`) : null;

  try {
    const { error } = await supabase
      .from("app_events")
      .insert({
        kind,
        address,
        chain_id: Number.isFinite(chainId) ? chainId : null,
        meta,
        ip_hash: ipHash,
        ua_hash: uaHash,
      });

    if (error) {
      return reply.send({ ok: true, reqId, skipped: true, reason: "INSERT_FAILED" });
    }
    return reply.send({ ok: true, reqId });
  } catch (err) {
    return reply.send({ ok: true, reqId, skipped: true, reason: "INSERT_FAILED" });
  }
});

app.post("/quote", async (request, reply) => {
  const reqId = request?.reqId;
  const logger = createLogger({ reqId });
  const body = request.body ?? {};
  const { chainId, ownerEoa, token, to, amount, feeMode, speed, mode, maxFeeUsd6 } = body;
  const rateLimited = enforceRateLimit(request, reply, ownerEoa);
  if (rateLimited) return rateLimited;
  if (!ownerEoa || !token || !to || !amount) {
    return reply.code(400).send({ ok: false, reqId, error: "missing_fields" });
  }
  const chain = chainId ?? Number(process.env.CHAIN_ID ?? 84532);
  try {
    const resolvedRpcUrl = await resolveRpcUrl({
      rpcUrl: process.env.RPC_URL,
      bundlerUrl: process.env.BUNDLER_URL,
      chainId: chain,
    });
    const result = await withTimeout(getQuote({
      chainId: chain,
      rpcUrl: resolvedRpcUrl,
      bundlerUrl: process.env.BUNDLER_URL,
      paymaster: getEnv("PAYMASTER", ["PAYMASTER_ADDRESS"]),
      factoryAddress: process.env.FACTORY,
      router: process.env.ROUTER,
      permit2: process.env.PERMIT2,
      ownerEoa,
      token,
      amount,
      feeMode,
      speed,
      mode,
      maxFeeUsd6,
      eip3009Tokens: process.env.EIP3009_TOKENS,
      eip2612Tokens: process.env.EIP2612_TOKENS,
      logger,
    }), 8000, {
      code: "RPC_TIMEOUT",
      status: 504,
      where: "quote.total",
      message: "RPC timeout",
    });
    if (result?.ok === false) {
      return reply.code(result.statusCode ?? 400).send({ reqId, ...result });
    }
    return reply.send({ reqId, ...result });
  } catch (err) {
    logger.error("QUOTE_ERROR", { error: err?.message || String(err) });
    return reply.code(err?.status || 500).send({
      ok: false,
      reqId,
      error: err?.message || "QUOTE_FAILED",
      code: err?.code || "QUOTE_FAILED",
      where: err?.where,
    });
  }
});

app.post("/quoteBulk", async (request, reply) => {
  const reqId = request?.reqId;
  const logger = createLogger({ reqId });
  const body = request.body ?? {};
  const { chainId, ownerEoa, from, token, to, amount, feeMode, speed, maxFeeUsd6 } = body;
  const wallet = ownerEoa || from;
  const rateLimited = enforceBulkRateLimit(request, reply, wallet);
  if (rateLimited) return rateLimited;

  const routerBulk = String(process.env.ROUTER_BULK || "").trim();
  const paymasterBulk = String(process.env.PAYMASTER_BULK || "").trim();
  if (!routerBulk || !paymasterBulk) {
    return reply.code(503).send({ ok: false, reqId, code: "BULK_NOT_CONFIGURED" });
  }

  if (!wallet || !token || !to || !amount) {
    return reply.code(400).send({ ok: false, reqId, error: "missing_fields" });
  }
  const chain = chainId ?? Number(process.env.CHAIN_ID ?? 84532);
  try {
    const resolvedRpcUrl = await resolveRpcUrl({
      rpcUrl: process.env.RPC_URL,
      bundlerUrl: process.env.BUNDLER_URL,
      chainId: chain,
    });
    const result = await withTimeout(getQuote({
      chainId: chain,
      rpcUrl: resolvedRpcUrl,
      bundlerUrl: process.env.BUNDLER_URL,
      paymaster: paymasterBulk,
      factoryAddress: process.env.FACTORY,
      router: routerBulk,
      permit2: process.env.PERMIT2,
      ownerEoa: wallet,
      token,
      amount,
      feeMode,
      speed,
      mode: "SPONSORED",
      maxFeeUsd6,
      eip3009Tokens: process.env.EIP3009_TOKENS,
      eip2612Tokens: process.env.EIP2612_TOKENS,
      logger,
    }), 8000, {
      code: "RPC_TIMEOUT",
      status: 504,
      where: "quoteBulk.total",
      message: "RPC timeout",
    });
    if (result?.ok === false) {
      return reply.code(result.statusCode ?? 400).send({ reqId, ...result });
    }
    return reply.send({ reqId, ...result });
  } catch (err) {
    logger.error("QUOTE_BULK_ERROR", { error: err?.message || String(err) });
    return reply.code(err?.status || 500).send({
      ok: false,
      reqId,
      error: err?.message || "QUOTE_FAILED",
      code: err?.code || "QUOTE_FAILED",
      where: err?.where,
    });
  }
});

app.post("/send", async (request, reply) => {
  const reqId = request?.reqId || crypto.randomUUID();
  const logger = createLogger({ reqId });
  try {
    const body = request.body ?? {};
    const {
      chainId,
      ownerEoa,
      token,
      to,
      amount,
      feeMode,
      speed,
      mode,
      receiptId,
      quotedFeeTokenAmount,
      auth,
      feeToken,
      userOpSignature,
        userOpDraft,
    } = body;

    const rateLimited = enforceRateLimit(request, reply, ownerEoa);
    if (rateLimited) return rateLimited;

    if (!ownerEoa || !token || !to || !amount || !receiptId) {
      return reply.code(400).send({ ok: false, reqId, error: "missing_fields" });
    }

    const chain = chainId ?? Number(process.env.CHAIN_ID ?? 84532);
    const resolvedRpcUrl = await resolveRpcUrl({
      rpcUrl: process.env.RPC_URL,
      bundlerUrl: process.env.BUNDLER_URL,
      chainId: chain,
    });
    const provider = new JsonRpcProvider(resolvedRpcUrl);

    let normalizedOwnerEoa;
    let normalizedToken;
    let normalizedTo;
    let normalizedFeeToken;
    try {
      normalizedOwnerEoa = await normalizeAddress(ownerEoa, { chainId: chain, provider });
      normalizedToken = await normalizeAddress(token, { chainId: chain, provider });
      normalizedTo = await normalizeAddress(to, { chainId: chain, provider });
      if (feeToken) {
        normalizedFeeToken = await normalizeAddress(feeToken, { chainId: chain, provider });
      }
    } catch (err) {
      return reply.code(err?.status || 500).send({ ok: false, error: err?.message || String(err), code: err?.code });
    }

    const { data: receipt, error: receiptError } = await supabase
      .from("quickpay_receipts")
      .select("id, status, owner_eoa")
      .eq("chain_id", chain)
      .eq("receipt_id", receiptId)
      .maybeSingle();

    if (receiptError) {
      return reply.code(500).send({ ok: false, error: receiptError.message });
    }
    if (!receipt) {
      return reply.code(404).send({ ok: false, error: "receipt_not_found" });
    }
    if (String(receipt.owner_eoa || "").toLowerCase() !== String(normalizedOwnerEoa).toLowerCase()) {
      return reply.code(403).send({ ok: false, error: "not_owner" });
    }
    if (["CONFIRMED", "FAILED"].includes(String(receipt.status || ""))) {
      return reply.send({ ok: true, receiptId });
    }

    await supabase
      .from("quickpay_receipts")
      .update({ status: "sending", owner_eoa: normalizedOwnerEoa.toLowerCase() })
      .eq("id", receipt.id);

    const factoryRaw = process.env.FACTORY ?? "";
    const factory = factoryRaw.trim();
    const smart = await resolveSmartAccount({
      rpcUrl: resolvedRpcUrl,
      factoryAddress: factory,
      factorySource: "env.FACTORY",
      ownerEoa: normalizedOwnerEoa,
    });

    let result;
    if (mode === "SELF_PAY") {
      result = await sendSelfPay({
        chainId: chain,
        ownerEoa: normalizedOwnerEoa,
        token: normalizedToken,
        to: normalizedTo,
        amount,
        feeMode,
        speed,
        receiptId,
        quotedFeeTokenAmount,
        auth,
        feeToken: normalizedFeeToken,
        smart,
      });
    } else {
      result = await sendSponsored({
        chainId: chain,
        rpcUrl: resolvedRpcUrl,
        bundlerUrl: process.env.BUNDLER_URL,
        ownerEoa: normalizedOwnerEoa,
        token: normalizedToken,
        to: normalizedTo,
        amount,
        feeMode,
        speed,
        receiptId,
        quotedFeeTokenAmount,
        auth,
        feeToken: normalizedFeeToken,
        smart,
        userOpSignature,
        userOpDraft,
        logger,
      });
    }

    if (result?.code === "NEEDS_APPROVE") {
      return reply.send({ reqId, ...result });
    }
    if (result?.needsUserOpSignature === true) {
      return reply.send({ reqId, ...result });
    }

    await supabase
      .from("quickpay_receipts")
      .update({
        status: "pending",
        owner_eoa: normalizedOwnerEoa.toLowerCase(),
        sender: smart.sender,
        userop_hash: result?.userOpHash ?? null,
        tx_hash: result?.txHash ?? null,
        fee_amount_raw: result?.feeAmountRaw ?? null,
        net_amount_raw: result?.netAmountRaw ?? null,
        lane: result?.lane ?? null,
      })
      .eq("id", receipt.id);

    let ethSponsoredWei = null;
    if (mode !== "SELF_PAY" && result?.txHash) {
      ethSponsoredWei = await recordSponsorshipCost({
        reqId,
        route: "send",
        txHash: result?.txHash ?? null,
        userOpHash: result?.userOpHash ?? null,
        chainId: chain,
        meta: { lane: result?.lane ?? null },
      });
    }

    return reply.send({
      ok: true,
      reqId,
      lane: result?.lane ?? null,
      userOpHash: result?.userOpHash ?? null,
      txHash: result?.txHash ?? null,
      ...(ethSponsoredWei ? { ethSponsoredWei } : {}),
    });
  } catch (err) {
    const debug = process.env.QUICKPAY_DEBUG === "1";
    logger.error("SEND_ERROR", { error: err?.message || String(err) });
    const detailPayload = err?.details ?? String(err?.stack || err);
    return reply.code(err?.status || 500).send({
      ok: false,
      reqId,
      error: String(err?.message || err),
      code: err?.code,
      details: debug ? detailPayload : undefined,
    });
  }
});

app.post("/sendBulk", async (request, reply) => {
  const reqId = request?.reqId || crypto.randomUUID();
  const logger = createLogger({ reqId });
  try {
    const body = request.body ?? {};
    const {
      chainId,
      ownerEoa,
      from,
      token,
      recipients,
      amounts,
      transfers,
      feeMode,
      speed,
      amountMode,
      name,
      message,
      reason,
      note,
      noteSender,
      noteSignature,
      auth,
      userOpSignature,
      userOpDraft,
      referenceId,
    } = body;

    const rateLimited = enforceBulkRateLimit(request, reply, ownerEoa);
    if (rateLimited) return rateLimited;

    const routerBulk = String(process.env.ROUTER_BULK || "").trim();
    const paymasterBulk = String(process.env.PAYMASTER_BULK || "").trim();
    if (!routerBulk || !paymasterBulk) {
      return reply.code(503).send({ ok: false, reqId, code: "BULK_NOT_CONFIGURED" });
    }

    const normalizedFrom = ownerEoa || from;
    if (!normalizedFrom || !token || (!recipients && !transfers) || (!amounts && !transfers)) {
      return reply.code(400).send({ ok: false, reqId, error: "missing_fields" });
    }

    const chain = chainId ?? Number(process.env.CHAIN_ID ?? 84532);
    const resolvedRpcUrl = await resolveRpcUrl({
      rpcUrl: process.env.RPC_URL,
      bundlerUrl: process.env.BUNDLER_URL,
      chainId: chain,
    });
    const provider = new JsonRpcProvider(resolvedRpcUrl);

    let normalizedOwnerEoa;
    let normalizedToken;
    const normalizedRecipients = [];
    const normalizedAmounts = [];
    try {
      normalizedOwnerEoa = await normalizeAddress(normalizedFrom, { chainId: chain, provider });
      normalizedToken = await normalizeAddress(token, { chainId: chain, provider });
      if (Array.isArray(transfers) && transfers.length) {
        for (const t of transfers) {
          const normalized = await normalizeAddress(t?.to, { chainId: chain, provider });
          normalizedRecipients.push(normalized);
          normalizedAmounts.push(t?.amount);
        }
      } else {
        if (!Array.isArray(recipients)) {
          return reply.code(400).send({ ok: false, reqId, error: "invalid_recipients" });
        }
        for (const addr of recipients) {
          const normalized = await normalizeAddress(addr, { chainId: chain, provider });
          normalizedRecipients.push(normalized);
        }
        if (Array.isArray(amounts)) {
          normalizedAmounts.push(...amounts);
        }
      }
    } catch (err) {
      return reply.code(err?.status || 500).send({ ok: false, error: err?.message || String(err), code: err?.code });
    }

    const result = await sendBulkSponsored({
      chainId: chain,
      rpcUrl: resolvedRpcUrl,
      bundlerUrl: process.env.BUNDLER_URL,
      entryPoint: process.env.ENTRYPOINT,
      router: routerBulk,
      paymaster: paymasterBulk,
      factory: process.env.FACTORY,
      feeVault: process.env.FEEVAULT,
      ownerEoa: normalizedOwnerEoa,
      token: normalizedToken,
      recipients: normalizedRecipients,
      amounts: normalizedAmounts.length ? normalizedAmounts : amounts,
      feeMode,
      speed,
      amountMode,
      auth,
      userOpSignature,
      userOpDraft,
      referenceId,
      logger,
    });

    if (result?.needsUserOpSignature === true) {
      return reply.send({ reqId, ...result });
    }

    const feeModeLabel = result?.modeUsed ?? amountMode ?? "net";
    const receiptId = generateReceiptId();

    const recipientAmounts = Array.isArray(result?.recipientAmounts) ? result.recipientAmounts : null;
    const recipientsMeta = Array.isArray(normalizedRecipients)
      ? normalizedRecipients.map((to, idx) => ({
          to,
          amount: recipientAmounts?.[idx] ?? null,
        }))
      : [];

    const totalDebited = result?.totalAmountRaw ?? null;
    const totalEntered = result?.modeUsed === "plusFee" ? result?.netAmountRaw ?? null : totalDebited;

    if (supabaseUrl && supabaseServiceRole) {
      try {
        await createBulkReceiptRecord({
          chainId: chain,
          receiptId,
          ownerEoa: normalizedOwnerEoa,
          sender: null,
          token: normalizedToken,
          amountRaw: result?.totalAmountRaw ?? null,
          netAmountRaw: result?.netAmountRaw ?? null,
          feeAmountRaw: result?.feeAmountRaw ?? null,
          feeMode: feeModeLabel,
          referenceId: result?.referenceId ?? referenceId ?? null,
          name,
          message,
          reason,
          recipients: recipientsMeta,
          modeUsed: result?.modeUsed ?? null,
          speed,
          totalEntered,
          totalDebited,
        });
      } catch (err) {
        logger.warn("BULK_RECEIPT_CREATE_FAILED", { error: err?.message || String(err) });
      }
    }

    let receiptResponse = null;
    if (result?.txHash || result?.userOpHash) {
      receiptResponse = await callQuickpayReceipt({
        receiptId,
        chainId: chain,
        txHash: result?.txHash ?? null,
        userOpHash: result?.userOpHash ?? null,
        from: normalizedOwnerEoa,
        token: normalizedToken,
        speed,
        mode: "SPONSORED",
        feeMode: feeModeLabel,
        recipients: recipientsMeta,
        totalEntered,
        feeAmount: result?.feeAmountRaw ?? null,
        totalDebited,
        name: name ?? null,
        message: message ?? null,
        reason: reason ?? null,
        referenceId: result?.referenceId ?? referenceId ?? null,
        route: "sendBulk",
      }, { reqId });
    }

    const resolvedReceiptId = receiptResponse?.receiptId ?? receiptId;
    if (note && noteSignature) {
      await callQuickpayNote({
        receiptId: resolvedReceiptId,
        sender: String(noteSender || normalizedOwnerEoa || "").toLowerCase(),
        note,
        signature: noteSignature,
        chainId: chain,
        reqId,
      });
    }

    let ethSponsoredWei = null;
    if (result?.txHash) {
      ethSponsoredWei = await recordSponsorshipCost({
        reqId,
        route: "sendBulk",
        txHash: result?.txHash ?? null,
        userOpHash: result?.userOpHash ?? null,
        chainId: chain,
        meta: { recipientCount: recipientsMeta.length, modeUsed: result?.modeUsed ?? null },
      });
    }

    return reply.send({
      ok: true,
      reqId,
      receiptId: resolvedReceiptId,
      fee: result?.feeAmountRaw ?? null,
      total: result?.totalAmountRaw ?? null,
      modeUsed: result?.modeUsed ?? null,
      ...(ethSponsoredWei ? { ethSponsoredWei } : {}),
      ...result,
    });
  } catch (err) {
    logger.error("SEND_BULK_ERROR", { error: err?.message || String(err) });
    return reply.code(err?.status || 500).send({
      ok: false,
      reqId,
      error: String(err?.message || err),
      code: err?.code,
      details: process.env.NODE_ENV === "production" ? undefined : String(err?.stack || err),
    });
  }
});

const port = Number(process.env.PORT ?? 8787);
app.listen({ port, host: "0.0.0.0" });
