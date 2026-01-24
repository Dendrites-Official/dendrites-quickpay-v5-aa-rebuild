import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { createClient } from "@supabase/supabase-js";
import { JsonRpcProvider } from "ethers";
import { getQuote } from "./core/quote.js";
import { resolveSmartAccount } from "./core/smartAccount.js";
import { sendSponsored } from "./core/sendSponsored.js";
import { sendSelfPay } from "./core/sendSelfPay.js";
import { normalizeAddress } from "./core/normalizeAddress.js";

const app = Fastify({ logger: true });

const corsOrigins = String(process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const allowedOrigins = corsOrigins.length
  ? corsOrigins
  : ["http://localhost:5173", "https://dendrites-testnet-ui.vercel.app"];

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

app.get("/health", async () => ({
  ok: true,
  build: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.BUILD_ID || new Date().toISOString(),
}));

app.post("/quote", async (request, reply) => {
  const body = request.body ?? {};
  const { chainId, ownerEoa, token, to, amount, feeMode, speed, mode } = body;
  if (!ownerEoa || !token || !to || !amount) {
    return reply.code(400).send({ ok: false, error: "missing_fields" });
  }
  const result = await getQuote({
    rpcUrl: process.env.RPC_URL,
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
    eip3009Tokens: process.env.EIP3009_TOKENS,
    eip2612Tokens: process.env.EIP2612_TOKENS,
  });
  if (result?.ok === false) {
    return reply.code(result.statusCode ?? 400).send(result);
  }
  return reply.send(result);
});

app.post("/send", async (request, reply) => {
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
  } = body;

  if (!ownerEoa || !token || !to || !amount || !receiptId) {
    return reply.code(400).send({ ok: false, error: "missing_fields" });
  }

  const chain = chainId ?? Number(process.env.CHAIN_ID ?? 84532);
  const rpcUrl = process.env.RPC_URL;
  const provider = new JsonRpcProvider(rpcUrl);

  let normalizedOwnerEoa;
  let normalizedToken;
  let normalizedTo;
  let normalizedFeeToken;
  try {
    normalizedOwnerEoa = await normalizeAddress(ownerEoa, provider);
    normalizedToken = await normalizeAddress(token, provider);
    normalizedTo = await normalizeAddress(to, provider);
    if (feeToken) {
      normalizedFeeToken = await normalizeAddress(feeToken, provider);
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

  try {
    const smart = await resolveSmartAccount({
      rpcUrl,
      factoryAddress: process.env.FACTORY ?? "",
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
      receiptId,
      userOpHash: result?.userOpHash ?? null,
      txHash: result?.txHash ?? null,
    });
  } catch (err) {
    await supabase
      .from("quickpay_receipts")
      .update({ status: "failed" })
      .eq("id", receipt.id);
    return reply.code(500).send({ ok: false, error: String(err?.message || err) });
  }
});

const port = Number(process.env.PORT ?? 8787);
app.listen({ port, host: "0.0.0.0" });
