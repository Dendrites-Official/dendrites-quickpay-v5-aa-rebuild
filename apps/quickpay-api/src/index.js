import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { createClient } from "@supabase/supabase-js";
import { JsonRpcProvider } from "ethers";
import crypto from "node:crypto";
import { getQuote } from "./core/quote.js";
import { resolveSmartAccount } from "./core/smartAccount.js";
import { sendSponsored } from "./core/sendSponsored.js";
import { sendSelfPay } from "./core/sendSelfPay.js";
import { normalizeAddress } from "./core/normalizeAddress.js";
import { resolveRpcUrl } from "./core/resolveRpcUrl.js";
import { registerFaucetRoutes } from "./routes/faucet.js";
import { registerWalletRoutes } from "./routes/wallet.js";

const app = Fastify({ logger: true });

app.setErrorHandler((err, request, reply) => {
  const status = err?.status || 500;
  reply.code(status).send({
    ok: false,
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

registerFaucetRoutes(app);
registerWalletRoutes(app);

app.get("/health", async () => ({
  ok: true,
  build: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.BUILD_ID || new Date().toISOString(),
}));

app.post("/quote", async (request, reply) => {
  const body = request.body ?? {};
  const { chainId, ownerEoa, token, to, amount, feeMode, speed, mode, maxFeeUsd6 } = body;
  if (!ownerEoa || !token || !to || !amount) {
    return reply.code(400).send({ ok: false, error: "missing_fields" });
  }
  const chain = chainId ?? Number(process.env.CHAIN_ID ?? 84532);
  const resolvedRpcUrl = await resolveRpcUrl({
    rpcUrl: process.env.RPC_URL,
    bundlerUrl: process.env.BUNDLER_URL,
    chainId: chain,
  });
  const result = await getQuote({
    chainId: chain,
    rpcUrl: resolvedRpcUrl,
    bundlerUrl: process.env.BUNDLER_URL,
    paymaster: process.env.PAYMASTER_ADDRESS ?? process.env.PAYMASTER,
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
  });
  if (result?.ok === false) {
    return reply.code(result.statusCode ?? 400).send(result);
  }
  return reply.send(result);
});

app.post("/send", async (request, reply) => {
  const reqId = crypto.randomUUID();
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

    if (!ownerEoa || !token || !to || !amount || !receiptId) {
      return reply.code(400).send({ ok: false, error: "missing_fields" });
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

    return reply.send({
      ok: true,
      reqId,
      lane: result?.lane ?? null,
      userOpHash: result?.userOpHash ?? null,
      txHash: result?.txHash ?? null,
    });
  } catch (err) {
    const debug = process.env.QUICKPAY_DEBUG === "1";
    console.error("[SEND_ERROR]", reqId, err?.message);
    console.error(err?.stack || err);
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

const port = Number(process.env.PORT ?? 8787);
app.listen({ port, host: "0.0.0.0" });
