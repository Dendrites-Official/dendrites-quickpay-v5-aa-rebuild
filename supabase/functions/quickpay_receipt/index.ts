import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const DECIMALS_SIG = "0x313ce567";
const SYMBOL_SIG = "0x95d89b41";
const DEFAULT_CHAIN_ID = 84532;

const RATE_LIMIT_WINDOW_SEC = Number(Deno.env.get("RATE_LIMIT_WINDOW_SEC") ?? 60);
const RATE_LIMIT_IP = Number(Deno.env.get("RATE_LIMIT_IP") ?? 120);
const RATE_LIMIT_WALLET = Number(Deno.env.get("RATE_LIMIT_WALLET") ?? 60);
const BURST_WINDOW_SEC = Number(Deno.env.get("RATE_LIMIT_BURST_WINDOW_SEC") ?? 10);
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const REDACT_KEYS = ["auth", "signature", "private", "secret", "key"];

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const lower = key.toLowerCase();
      output[key] = REDACT_KEYS.some((needle) => lower.includes(needle)) ? "[REDACTED]" : redact(val);
    }
    return output;
  }
  return value;
}

function logInfo(reqId: string, message: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level: "info", reqId, message, ...redact(data) }));
}

function getClientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  if (forwarded) return forwarded.split(",")[0].trim();
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

function getWalletFromBody(body: Record<string, unknown>) {
  const candidates = [body.ownerEoa, body.sender, body.address, body.wallet];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim().toLowerCase();
  }
  return null;
}

function getRateLimitEntry(key: string, windowMs: number) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || now > entry.resetAt) {
    const fresh = { count: 0, resetAt: now + windowMs };
    rateLimitStore.set(key, fresh);
    return fresh;
  }
  return entry;
}

function checkRateLimit(key: string, limit: number, windowSec: number) {
  const windowMs = Math.max(1, windowSec) * 1000;
  const entry = getRateLimitEntry(key, windowMs);
  entry.count += 1;
  if (entry.count <= limit) return { allowed: true };
  const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
  return { allowed: false, retryAfterSec };
}

function enforceRateLimit(ip: string, wallet: string | null) {
  const burstIpLimit = Math.max(1, Math.ceil(RATE_LIMIT_IP * (BURST_WINDOW_SEC / RATE_LIMIT_WINDOW_SEC)));
  const burstWalletLimit = Math.max(1, Math.ceil(RATE_LIMIT_WALLET * (BURST_WINDOW_SEC / RATE_LIMIT_WINDOW_SEC)));

  const ipBurst = checkRateLimit(`ip:burst:${ip}`, burstIpLimit, BURST_WINDOW_SEC);
  if (!ipBurst.allowed) return { retryAfterSec: ipBurst.retryAfterSec };
  const ipSustain = checkRateLimit(`ip:sustain:${ip}`, RATE_LIMIT_IP, RATE_LIMIT_WINDOW_SEC);
  if (!ipSustain.allowed) return { retryAfterSec: ipSustain.retryAfterSec };

  if (wallet) {
    const walletBurst = checkRateLimit(`wallet:burst:${wallet}`, burstWalletLimit, BURST_WINDOW_SEC);
    if (!walletBurst.allowed) return { retryAfterSec: walletBurst.retryAfterSec };
    const walletSustain = checkRateLimit(`wallet:sustain:${wallet}`, RATE_LIMIT_WALLET, RATE_LIMIT_WINDOW_SEC);
    if (!walletSustain.allowed) return { retryAfterSec: walletSustain.retryAfterSec };
  }
  return null;
}

function jsonResponse(origin: string | undefined, status: number, body: unknown, reqId?: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), ...(reqId ? { "x-request-id": reqId } : {}) },
  });
}

function isValidHash(value: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function parseBigInt(hexValue: string | undefined) {
  try {
    if (!hexValue) return 0n;
    return BigInt(hexValue);
  } catch {
    return 0n;
  }
}

function randomReceiptId(length = 6) {
  const alphabet = "0123456789abcdefghjkmnpqrstuvwxyz";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return `r_${out}`;
}

async function jsonRpcCall(url: string, method: string, params: unknown[], timeoutMs = 2000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error("RPC request failed");
  }

  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.error?.message || "RPC error");
  }
  return payload?.result ?? null;
}

function hexToBytes(hex: string) {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(Math.max(0, normalized.length / 2));
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function decodeBytes32String(hex: string) {
  const bytes = hexToBytes(hex);
  let out = "";
  for (const byte of bytes) {
    if (byte === 0) break;
    out += String.fromCharCode(byte);
  }
  return out || null;
}

function decodeAbiString(hex: string) {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length <= 64) {
    return decodeBytes32String(hex);
  }

  try {
    const offset = parseInt(normalized.slice(0, 64), 16);
    const length = parseInt(normalized.slice(offset * 2, offset * 2 + 64), 16);
    const start = offset * 2 + 64;
    const data = normalized.slice(start, start + length * 2);
    const bytes = hexToBytes(data);
    let out = "";
    for (const byte of bytes) {
      out += String.fromCharCode(byte);
    }
    return out || null;
  } catch {
    return decodeBytes32String(hex);
  }
}

function formatUnits(value: bigint, decimals: number | null) {
  if (decimals === null || decimals < 0) return value.toString();
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  if (fraction === 0n) return whole.toString();
  const padded = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${padded}`;
}

async function fetchTokenMeta(token: string, rpcUrl: string) {
  let decimals: number | null = null;
  let symbol: string | null = null;

  try {
    const decResult = await jsonRpcCall(rpcUrl, "eth_call", [
      { to: token, data: DECIMALS_SIG },
      "latest",
    ]);
    if (decResult) {
      decimals = parseInt(decResult, 16);
    }
  } catch {
    decimals = null;
  }

  try {
    const symResult = await jsonRpcCall(rpcUrl, "eth_call", [
      { to: token, data: SYMBOL_SIG },
      "latest",
    ]);
    if (symResult) {
      symbol = decodeAbiString(symResult);
    }
  } catch {
    symbol = null;
  }

  return { symbol, decimals };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? undefined;
  const reqId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return handleOptions(req);
  }

  if (req.method !== "POST") {
    return jsonResponse(origin, 405, { error: "Method not allowed" }, reqId);
  }

  let body: {
    chainId?: number;
    receiptId?: string;
    userOpHash?: string;
    txHash?: string;
    from?: string;
    token?: string;
    speed?: number | string;
    mode?: string;
    feeMode?: string;
    recipients?: Array<{ to?: string; amount?: string }>;
    totalEntered?: string;
    feeAmount?: string;
    totalDebited?: string;
    name?: string;
    message?: string;
    reason?: string;
    referenceId?: string;
    route?: string;
  } = {};

  try {
    body = (await req.json()) ?? {};
  } catch {
    return jsonResponse(origin, 400, { error: "Invalid JSON body" }, reqId);
  }

  const ip = getClientIp(req);
  const wallet = getWalletFromBody(body as Record<string, unknown>);
  const limited = enforceRateLimit(ip, wallet);
  if (limited) {
    logInfo(reqId, "RATE_LIMITED", { ip, wallet });
    return jsonResponse(origin, 429, { ok: false, code: "RATE_LIMITED", retryAfterSec: limited.retryAfterSec }, reqId);
  }

  logInfo(reqId, "RECEIPT_REQUEST", { ip, wallet, body });

  const chainId = body.chainId ?? DEFAULT_CHAIN_ID;
  const receiptIdInput = body.receiptId?.trim();
  const userOpHashInput = body.userOpHash?.trim();
  const txHashInput = body.txHash?.trim();

  if (userOpHashInput && !isValidHash(userOpHashInput)) {
    return jsonResponse(origin, 400, { error: "Invalid userOpHash" }, reqId);
  }

  if (txHashInput && !isValidHash(txHashInput)) {
    return jsonResponse(origin, 400, { error: "Invalid txHash" }, reqId);
  }

  if (!receiptIdInput && !userOpHashInput && !txHashInput) {
    return jsonResponse(origin, 400, { error: "Missing receiptId, userOpHash, or txHash" }, reqId);
  }

  const bundlerUrl = Deno.env.get("BUNDLER_URL");
  if (!bundlerUrl) {
    return jsonResponse(origin, 500, { error: "Missing BUNDLER_URL" }, reqId);
  }

  const rpcUrl = Deno.env.get("RPC_URL") ?? "";
  const feeVaultRaw = Deno.env.get("FEE_VAULT") ?? "";
  const feeVault = feeVaultRaw ? feeVaultRaw.toLowerCase() : "";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseKey = supabaseServiceRole || supabaseAnonKey;
  if (!supabaseUrl || !supabaseKey) {
    return jsonResponse(origin, 500, { error: "Missing Supabase env" }, reqId);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let existing: any = null;
  if (receiptIdInput) {
    const { data } = await supabase
      .from("quickpay_receipts")
      .select("*")
      .eq("chain_id", chainId)
      .eq("receipt_id", receiptIdInput)
      .maybeSingle();
    existing = data ?? null;
  } else if (userOpHashInput) {
    const { data } = await supabase
      .from("quickpay_receipts")
      .select("*")
      .eq("chain_id", chainId)
      .eq("userop_hash", userOpHashInput)
      .maybeSingle();
    existing = data ?? null;
  } else if (txHashInput) {
    const { data } = await supabase
      .from("quickpay_receipts")
      .select("*")
      .eq("chain_id", chainId)
      .eq("tx_hash", txHashInput)
      .maybeSingle();
    existing = data ?? null;
  }

  if (receiptIdInput && !existing && !userOpHashInput && !txHashInput) {
    return jsonResponse(origin, 404, { error: "Receipt not found" }, reqId);
  }

  const userOpHash = userOpHashInput ?? existing?.userop_hash ?? null;
  const txHash = txHashInput ?? existing?.tx_hash ?? null;
  const receiptId = receiptIdInput ?? existing?.receipt_id ?? randomReceiptId();

  const bodyToken = body.token ? String(body.token).toLowerCase() : null;
  const bodyFrom = body.from ? String(body.from).toLowerCase() : null;
  const bodyFeeMode = body.feeMode ? String(body.feeMode) : null;
  const bodyMode = body.mode ? String(body.mode) : null;
  const bodyRoute = body.route ? String(body.route) : null;
  const bodyTo = body.to ? String(body.to).toLowerCase() : null;
  const recipientsInput = Array.isArray(body.recipients)
    ? body.recipients.map((entry) => ({
        to: entry?.to ? String(entry.to).toLowerCase() : null,
        amount: entry?.amount ? String(entry.amount) : null,
      }))
    : null;

  const totalEnteredRaw = body.totalEntered ? String(body.totalEntered) : null;
  const feeAmountRaw = body.feeAmount ? String(body.feeAmount) : null;
  const totalDebitedRaw = body.totalDebited ? String(body.totalDebited) : null;
  const isSponsoredZeroFee =
    String(bodyMode || "").toLowerCase() === "sponsored" && (feeAmountRaw === "0" || feeAmountRaw === "0x0");

  let derivedNetRaw: string | null = null;
  let derivedAmountRaw: string | null = null;
  if (totalEnteredRaw && feeAmountRaw) {
    try {
      const totalEntered = BigInt(totalEnteredRaw);
      const feeAmount = BigInt(feeAmountRaw);
      if (String(bodyFeeMode || "").toLowerCase() === "plusfee") {
        derivedNetRaw = totalEntered.toString();
        derivedAmountRaw = totalDebitedRaw ? String(totalDebitedRaw) : (totalEntered + feeAmount).toString();
      } else {
        derivedNetRaw = (totalEntered - feeAmount).toString();
        derivedAmountRaw = totalEntered.toString();
      }
    } catch {
      derivedNetRaw = null;
      derivedAmountRaw = null;
    }
  }

  const incomingMeta: Record<string, unknown> = {
    ...(bodyRoute ? { route: bodyRoute } : {}),
    ...(bodyMode ? { mode: bodyMode } : {}),
    ...(bodyFeeMode ? { modeUsed: bodyFeeMode } : {}),
    ...(totalEnteredRaw ? { totalEntered: totalEnteredRaw } : {}),
    ...(totalDebitedRaw ? { totalDebited: totalDebitedRaw } : {}),
    ...(feeAmountRaw ? { feeAmount: feeAmountRaw } : {}),
  };
  const mergedMeta = {
    ...(existing?.meta && typeof existing.meta === "object" ? existing.meta : {}),
    ...incomingMeta,
    ...(recipientsInput ? { recipients: recipientsInput } : {}),
  };

  let receiptResult: any = null;
  let receiptSource: "userOp" | "tx" | null = null;

  try {
    if (userOpHash) {
      receiptResult = await jsonRpcCall(bundlerUrl, "eth_getUserOperationReceipt", [userOpHash]);
      receiptSource = "userOp";
    } else if (txHash && rpcUrl) {
      receiptResult = await jsonRpcCall(rpcUrl, "eth_getTransactionReceipt", [txHash]);
      receiptSource = "tx";
    }
  } catch (err: any) {
    return jsonResponse(origin, 502, { error: err?.message || "Receipt lookup failed" }, reqId);
  }

  if (!receiptResult) {
    const pendingPayload = {
      chain_id: chainId,
      receipt_id: receiptId,
      userop_hash: userOpHash ?? null,
      tx_hash: txHash ?? null,
      status: "PENDING",
      success: null,
      lane: existing?.lane ?? null,
      fee_mode: existing?.fee_mode ?? bodyFeeMode ?? null,
      fee_token_mode: existing?.fee_token_mode ?? (isSponsoredZeroFee ? "sponsored" : (feeAmountRaw ? "same" : null)),
      token: existing?.token ?? bodyToken ?? null,
      to: existing?.to ?? bodyTo ?? recipientsInput?.[0]?.to ?? null,
      sender: existing?.sender ?? null,
      owner_eoa: existing?.owner_eoa ?? bodyFrom ?? null,
      net_amount_raw: existing?.net_amount_raw ?? derivedNetRaw ?? null,
      fee_amount_raw: existing?.fee_amount_raw ?? feeAmountRaw ?? null,
      amount_raw: existing?.amount_raw ?? derivedAmountRaw ?? totalDebitedRaw ?? null,
      fee_vault: feeVault || (existing?.fee_vault ?? null),
      title: existing?.title ?? (body.message ? String(body.message) : null),
      note: existing?.note ?? null,
      reference_id: existing?.reference_id ?? (body.referenceId ? String(body.referenceId) : null),
      display_name: existing?.display_name ?? (body.name ? String(body.name) : null),
      reason: existing?.reason ?? (body.reason ? String(body.reason) : null),
      created_by: existing?.created_by ?? null,
      token_symbol: existing?.token_symbol ?? null,
      token_decimals: existing?.token_decimals ?? null,
      raw: existing?.raw ?? null,
      recipients_count: existing?.recipients_count ?? (recipientsInput ? recipientsInput.length : null),
      meta: Object.keys(mergedMeta).length ? mergedMeta : existing?.meta ?? null,
    };

    if (existing?.id) {
      await supabase.from("quickpay_receipts").update(pendingPayload).eq("id", existing.id);
    } else {
      await supabase.from("quickpay_receipts").insert(pendingPayload);
    }

    return jsonResponse(origin, 202, {
      status: "PENDING",
      receiptId,
      userOpHash,
      txHash,
      ownerEoa: pendingPayload.owner_eoa ?? null,
      title: pendingPayload.title,
      note: pendingPayload.note,
      referenceId: pendingPayload.reference_id,
    }, reqId);
  }

  const resolvedTxHash =
    receiptSource === "userOp"
      ? receiptResult?.receipt?.transactionHash ??
        receiptResult?.transactionHash ??
        receiptResult?.receipt?.transactionReceipt?.transactionHash ??
        txHash ??
        null
      : receiptResult?.transactionHash ?? txHash ?? null;

  let success: boolean | null = null;
  if (receiptSource === "userOp") {
    if (typeof receiptResult?.success === "boolean") {
      success = receiptResult.success;
    } else if (receiptResult?.receipt?.status !== undefined) {
      const statusValue = receiptResult.receipt.status;
      success = statusValue === "0x1" || statusValue === 1;
    }
  } else if (receiptSource === "tx") {
    const statusValue = receiptResult?.status;
    if (statusValue !== undefined) {
      success = statusValue === "0x1" || statusValue === 1;
    }
  }

  const logsSource = receiptSource === "userOp"
    ? Array.isArray(receiptResult?.logs)
      ? receiptResult.logs
      : Array.isArray(receiptResult?.receipt?.logs)
        ? receiptResult.receipt.logs
        : []
    : Array.isArray(receiptResult?.logs)
      ? receiptResult.logs
      : [];

  type Transfer = { token: string; from: string; to: string; value: bigint };
  const transfers: Transfer[] = [];

  for (const log of logsSource) {
    const topics: string[] = Array.isArray(log?.topics) ? log.topics : [];
    if (!topics[0] || topics[0].toLowerCase() !== TRANSFER_TOPIC) continue;
    if (topics.length < 3) continue;
    const token = String(log?.address ?? "").toLowerCase();
    const fromTopic = topics[1];
    const toTopic = topics[2];
    const from = `0x${fromTopic.slice(-40)}`.toLowerCase();
    const to = `0x${toTopic.slice(-40)}`.toLowerCase();
    const value = parseBigInt(log?.data);
    if (!token || !to || !from) continue;
    transfers.push({ token, from, to, value });
  }

  const preferredToken = existing?.token ? String(existing.token).toLowerCase() : null;
  const preferredRecipient = existing?.to ? String(existing.to).toLowerCase() : (bodyTo ?? recipientsInput?.[0]?.to ?? null);
  const preferredOwner = existing?.owner_eoa ? String(existing.owner_eoa).toLowerCase() : null;

  const detectPullHub = (source: Transfer[]) => {
    if (!preferredOwner) return null;
    const inbound = new Map<string, bigint>();
    const outbound = new Map<string, bigint>();

    for (const transfer of source) {
      if (transfer.from === preferredOwner) {
        inbound.set(transfer.to, (inbound.get(transfer.to) ?? 0n) + transfer.value);
      }
      if (transfer.from) {
        outbound.set(transfer.from, (outbound.get(transfer.from) ?? 0n) + transfer.value);
      }
    }

    let bestHub: string | null = null;
    let bestScore = 0n;
    for (const [hub, inValue] of inbound.entries()) {
      const outValue = outbound.get(hub) ?? 0n;
      if (outValue <= 0n) continue;
      const score = inValue + outValue;
      if (!bestHub || score > bestScore) {
        bestHub = hub;
        bestScore = score;
      }
    }

    return bestHub;
  };

  const buildGroups = (source: Transfer[]) => {
    const map = new Map<string, { feeAmount: bigint; toAmount: bigint; recipient: string | null }>();
    for (const transfer of source) {
      if (pullHub && preferredOwner && transfer.from === preferredOwner && transfer.to === pullHub) {
        continue;
      }
      const entry = map.get(transfer.token) ?? {
        feeAmount: 0n,
        toAmount: 0n,
        recipient: null,
      };

      if (feeVault && transfer.to === feeVault) {
        entry.feeAmount += transfer.value;
      } else {
        entry.toAmount += transfer.value;
        if (!entry.recipient) entry.recipient = transfer.to;
      }

      map.set(transfer.token, entry);
    }
    return map;
  };

  const pullHub = detectPullHub(transfers);
  let groups = buildGroups(transfers);

  if (preferredToken || preferredRecipient) {
    const preferredTransfers = transfers.filter((transfer) => {
      if (preferredToken && transfer.token !== preferredToken) return false;
      if (preferredRecipient && transfer.to !== preferredRecipient && (!feeVault || transfer.to !== feeVault)) {
        return false;
      }
      return true;
    });
    const preferredGroups = buildGroups(preferredTransfers);
    if (preferredGroups.size > 0) {
      groups = preferredGroups;
    }
  }

  let chosenToken: string | null = null;
  let chosenRecipient: string | null = null;
  let chosenFeeAmount = 0n;
  let chosenToAmount = 0n;
  let chosenScore = 0n;

  const bulkRecipients = Array.isArray(existing?.meta?.recipients) ? existing?.meta?.recipients : null;
  const existingNet = existing?.net_amount_raw != null ? BigInt(existing.net_amount_raw) : null;
  const existingFee = existing?.fee_amount_raw != null ? BigInt(existing.fee_amount_raw) : null;
  if (existing?.token && existingNet != null && existingFee != null && bulkRecipients) {
    chosenToken = existing.token;
    chosenRecipient = existing?.to ?? bulkRecipients?.[0]?.to ?? null;
    chosenToAmount = existingNet;
    chosenFeeAmount = existingFee;
    chosenScore = chosenToAmount + chosenFeeAmount;
  } else {
    for (const [token, entry] of groups.entries()) {
      const score = feeVault ? entry.feeAmount + entry.toAmount : entry.toAmount;
      const hasToAmount = entry.toAmount > 0n;
      if (!hasToAmount) continue;
      if (score <= 0n) continue;
      if (chosenToken === null || score > chosenScore) {
        chosenToken = token;
        chosenRecipient = entry.recipient;
        chosenFeeAmount = entry.feeAmount;
        chosenToAmount = entry.toAmount;
        chosenScore = score;
      }
    }
  }

  const amountRaw = chosenFeeAmount + chosenToAmount;

  let tokenSymbol: string | null = existing?.token_symbol ?? null;
  let tokenDecimals: number | null = existing?.token_decimals ?? null;

  if (chosenToken && rpcUrl) {
    try {
      const meta = await fetchTokenMeta(chosenToken, rpcUrl);
      tokenSymbol = meta.symbol ?? tokenSymbol ?? null;
      tokenDecimals = meta.decimals ?? tokenDecimals ?? null;
    } catch {
      // ignore
    }
  }

  if (tokenDecimals === null || tokenDecimals === undefined) {
    tokenDecimals = 18;
  }

  const sender =
    receiptSource === "userOp"
      ? receiptResult?.sender ?? receiptResult?.receipt?.sender ?? receiptResult?.receipt?.from ?? null
      : receiptResult?.from ?? null;

  const status = success === false ? "FAILED" : "CONFIRMED";
  const defaultFeeMode = chosenFeeAmount > 0n ? "eco" : "unknown";
  const defaultFeeTokenMode = chosenFeeAmount > 0n ? "same" : (isSponsoredZeroFee ? "sponsored" : null);

  const rowPayload = {
    chain_id: chainId,
    receipt_id: receiptId,
    userop_hash: userOpHash ?? null,
    tx_hash: resolvedTxHash ?? null,
    status,
    success,
    lane: existing?.lane ?? "RECEIPT_ONLY",
    fee_mode: existing?.fee_mode ?? bodyFeeMode ?? defaultFeeMode,
    fee_token_mode: existing?.fee_token_mode ?? defaultFeeTokenMode,
    token: chosenToken,
    to: chosenRecipient ?? existing?.to ?? bodyTo ?? recipientsInput?.[0]?.to ?? null,
    sender,
    owner_eoa: existing?.owner_eoa ?? bodyFrom ?? null,
    net_amount_raw: chosenToAmount.toString(),
    fee_amount_raw: feeAmountRaw ?? chosenFeeAmount.toString(),
    amount_raw: amountRaw.toString(),
    fee_vault: feeVault || (existing?.fee_vault ?? null),
    title: existing?.title ?? (body.message ? String(body.message) : null),
    note: existing?.note ?? null,
    reference_id: existing?.reference_id ?? (body.referenceId ? String(body.referenceId) : null),
    display_name: existing?.display_name ?? (body.name ? String(body.name) : null),
    reason: existing?.reason ?? (body.reason ? String(body.reason) : null),
    created_by: existing?.created_by ?? null,
    token_symbol: tokenSymbol,
    token_decimals: tokenDecimals,
    raw: receiptResult,
    recipients_count: existing?.recipients_count ?? (recipientsInput ? recipientsInput.length : null),
    meta: Object.keys(mergedMeta).length ? mergedMeta : existing?.meta ?? null,
  };

  if (existing?.id) {
    await supabase.from("quickpay_receipts").update(rowPayload).eq("id", existing.id);
  } else {
    await supabase.from("quickpay_receipts").insert(rowPayload);
  }

  const amount = formatUnits(amountRaw, tokenDecimals);
  const netAmount = formatUnits(chosenToAmount, tokenDecimals);
  const feeAmount = formatUnits(chosenFeeAmount, tokenDecimals);

  return jsonResponse(origin, 200, {
    status,
    receiptId,
    userOpHash,
    txHash: resolvedTxHash,
    success,
    token: chosenToken,
    tokenSymbol,
    tokenDecimals,
    to: chosenRecipient,
    sender,
    ownerEoa: rowPayload.owner_eoa ?? null,
    amountRaw: amountRaw.toString(),
    netAmountRaw: chosenToAmount.toString(),
    feeAmountRaw: chosenFeeAmount.toString(),
    amount,
    netAmount,
    feeAmount,
    title: rowPayload.title,
    note: rowPayload.note,
    displayName: rowPayload.display_name,
    reason: rowPayload.reason,
    createdBy: rowPayload.created_by,
    referenceId: rowPayload.reference_id,
    feeVault: rowPayload.fee_vault,
    lane: rowPayload.lane,
    feeMode: rowPayload.fee_mode ?? defaultFeeMode,
    feeTokenMode: rowPayload.fee_token_mode ?? defaultFeeTokenMode,
    meta: rowPayload.meta ?? existing?.meta ?? null,
    recipientsCount: rowPayload.recipients_count ?? existing?.recipients_count ?? null,
    raw: receiptResult,
  }, reqId);
});

// curl -X POST http://localhost:54321/functions/v1/quickpay_receipt \
//   -H "Content-Type: application/json" \
//   -d '{"userOpHash":"0x..."}'
