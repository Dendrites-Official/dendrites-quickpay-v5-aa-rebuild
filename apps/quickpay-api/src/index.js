import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { createClient } from "@supabase/supabase-js";
import { getQuote } from "./core/quote.js";
import { resolveSmartAccount } from "./core/smartAccount.js";
import { sendSponsored } from "./core/sendSponsored.js";
import { sendSelfPay } from "./core/sendSelfPay.js";

const app = Fastify({ logger: true });

const allowedOrigins = new Set(
  String(process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .concat([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:5174",
      "http://127.0.0.1:5174",
    ])
);

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    return cb(new Error("Not allowed"), false);
  },
  methods: ["GET", "POST", "OPTIONS"],
});

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseServiceRole);

app.get("/health", async () => ({ ok: true }));

app.post("/quote", async (request, reply) => {
  const body = request.body ?? {};
  const { chainId, ownerEoa, token, to, amount, feeMode, speed, mode } = body;
  if (!ownerEoa || !token || !to || !amount) {
    return reply.code(400).send({ ok: false, error: "missing_fields" });
  }
  const result = await getQuote({
    rpcUrl: process.env.RPC_URL,
    paymaster: process.env.PAYMASTER_ADDRESS ?? process.env.PAYMASTER,
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
  } = body;

  if (!ownerEoa || !token || !to || !amount || !receiptId) {
    return reply.code(400).send({ ok: false, error: "missing_fields" });
  }

  const chain = chainId ?? Number(process.env.CHAIN_ID ?? 84532);

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
  if (String(receipt.owner_eoa || "").toLowerCase() !== String(ownerEoa).toLowerCase()) {
    return reply.code(403).send({ ok: false, error: "not_owner" });
  }
  if (["CONFIRMED", "FAILED"].includes(String(receipt.status || ""))) {
    return reply.send({ ok: true, receiptId });
  }

  await supabase
    .from("quickpay_receipts")
    .update({ status: "sending", owner_eoa: ownerEoa.toLowerCase() })
    .eq("id", receipt.id);

  try {
    const smart = await resolveSmartAccount({
      rpcUrl: process.env.RPC_URL,
      factoryAddress: process.env.FACTORY ?? "",
      ownerEoa,
    });

    let result;
    if (mode === "SELF_PAY") {
      result = await sendSelfPay({
        chainId: chain,
        ownerEoa,
        token,
        to,
        amount,
        feeMode,
        speed,
        receiptId,
        quotedFeeTokenAmount,
        auth,
        smart,
      });
    } else {
      result = await sendSponsored({
        chainId: chain,
        ownerEoa,
        token,
        to,
        amount,
        feeMode,
        speed,
        receiptId,
        quotedFeeTokenAmount,
        auth,
        smart,
      });
    }

    await supabase
      .from("quickpay_receipts")
      .update({
        status: "pending",
        owner_eoa: ownerEoa.toLowerCase(),
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
