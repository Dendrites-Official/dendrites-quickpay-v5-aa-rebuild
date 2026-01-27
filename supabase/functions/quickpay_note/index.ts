import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyMessage } from "https://esm.sh/ethers@6";

function jsonResponse(origin: string | undefined, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin),
  });
}

function isValidReceiptId(value: string) {
  return value.startsWith("r_") && value.length >= 4 && value.length <= 64;
}

function isValidAddress(value: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isValidSignature(value: string) {
  return /^0x[0-9a-fA-F]+$/.test(value) && value.length >= 66;
}

function buildMessage(action: "SET" | "READ", receiptId: string, senderLower: string, chainId: number) {
  return `Dendrites QuickPay Note v1\nAction: ${action}\nReceipt: ${receiptId}\nSender: ${senderLower}\nChainId: ${chainId}`;
}

function extractReceiptSender(receipt: Record<string, unknown> | null) {
  if (!receipt) return "";
  const candidate =
    (receipt.owner_eoa as string | undefined) ||
    (receipt.sender as string | undefined) ||
    "";
  return typeof candidate === "string" ? candidate.toLowerCase() : "";
}

async function verifySignature(sender: string, message: string, signature: string) {
  try {
    const recovered = await verifyMessage(message, signature);
    return recovered.toLowerCase() === sender.toLowerCase();
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? undefined;

  if (req.method === "OPTIONS") {
    return handleOptions(req);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(origin, 500, { error: "Missing Supabase service role env" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (req.method === "POST") {
    let body: { receiptId?: string; sender?: string; note?: string; signature?: string; chainId?: number } = {};
    try {
      body = (await req.json()) ?? {};
    } catch {
      return jsonResponse(origin, 400, { error: "Invalid JSON body" });
    }

    const receiptId = body.receiptId?.trim() ?? "";
    const sender = body.sender?.trim() ?? "";
    const note = body.note ?? "";
    const signature = body.signature?.trim() ?? "";
    const chainId = Number.isFinite(Number(body.chainId)) ? Number(body.chainId) : 84532;

    if (!receiptId || !isValidReceiptId(receiptId)) {
      return jsonResponse(origin, 400, { error: "Invalid receiptId" });
    }
    if (!sender || !isValidAddress(sender)) {
      return jsonResponse(origin, 400, { error: "Invalid sender" });
    }
    if (!note) {
      return jsonResponse(origin, 400, { error: "Missing note" });
    }
    if (note.length > 5000) {
      return jsonResponse(origin, 400, { error: "Note too long" });
    }
    if (!signature || !isValidSignature(signature)) {
      return jsonResponse(origin, 400, { error: "Missing signature" });
    }

    const senderLower = sender.toLowerCase();
    const message = buildMessage("SET", receiptId, senderLower, chainId);
    const ok = await verifySignature(senderLower, message, signature);
    if (!ok) {
      return jsonResponse(origin, 401, { error: "Invalid signature" });
    }

    const { data: receipt, error: receiptError } = await supabase
      .from("quickpay_receipts")
      .select("owner_eoa, sender")
      .eq("chain_id", chainId)
      .eq("receipt_id", receiptId)
      .maybeSingle();

    if (receiptError) {
      return jsonResponse(origin, 500, { error: receiptError.message });
    }
    if (!receipt) {
      return jsonResponse(origin, 404, { error: "receipt_not_found" });
    }

    const receiptSenderLower = extractReceiptSender(receipt);
    if (!receiptSenderLower) {
      return jsonResponse(origin, 500, { error: "receipt_sender_missing" });
    }
    if (receiptSenderLower !== senderLower) {
      return jsonResponse(origin, 403, { error: "not_sender" });
    }

    const { data: existingNote, error: existingError } = await supabase
      .from("quickpay_receipt_notes")
      .select("sender_address")
      .eq("chain_id", chainId)
      .eq("receipt_id", receiptId)
      .maybeSingle();

    if (existingError) {
      return jsonResponse(origin, 500, { error: existingError.message });
    }
    if (existingNote && existingNote.sender_address?.toLowerCase() !== senderLower) {
      return jsonResponse(origin, 409, { error: "note_owned_by_other_sender" });
    }

    const { error } = await supabase
      .from("quickpay_receipt_notes")
      .upsert({
        chain_id: chainId,
        receipt_id: receiptId,
        sender_address: senderLower,
        note,
        updated_at: new Date().toISOString(),
      });

    if (error) {
      return jsonResponse(origin, 500, { error: error.message });
    }

    return jsonResponse(origin, 200, { ok: true });
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    const receiptId = url.searchParams.get("receiptId")?.trim() ?? "";
    const sender = url.searchParams.get("sender")?.trim() ?? "";
    const signature = url.searchParams.get("signature")?.trim() ?? "";
    const chainId = Number.isFinite(Number(url.searchParams.get("chainId")))
      ? Number(url.searchParams.get("chainId"))
      : 84532;

    if (!receiptId || !isValidReceiptId(receiptId)) {
      return jsonResponse(origin, 400, { error: "Invalid receiptId" });
    }
    if (!sender || !isValidAddress(sender)) {
      return jsonResponse(origin, 400, { error: "Invalid sender" });
    }
    if (!signature || !isValidSignature(signature)) {
      return jsonResponse(origin, 400, { error: "Missing signature" });
    }

    const senderLower = sender.toLowerCase();
    const message = buildMessage("READ", receiptId, senderLower, chainId);
    const ok = await verifySignature(senderLower, message, signature);
    if (!ok) {
      return jsonResponse(origin, 401, { error: "Invalid signature" });
    }

    const { data: receipt, error: receiptError } = await supabase
      .from("quickpay_receipts")
      .select("owner_eoa, sender")
      .eq("chain_id", chainId)
      .eq("receipt_id", receiptId)
      .maybeSingle();

    if (receiptError) {
      return jsonResponse(origin, 500, { error: receiptError.message });
    }
    if (!receipt) {
      return jsonResponse(origin, 404, { error: "receipt_not_found" });
    }

    const receiptSenderLower = extractReceiptSender(receipt);
    if (!receiptSenderLower) {
      return jsonResponse(origin, 500, { error: "receipt_sender_missing" });
    }
    if (receiptSenderLower !== senderLower) {
      return jsonResponse(origin, 403, { error: "not_sender" });
    }

    const { data, error } = await supabase
      .from("quickpay_receipt_notes")
      .select("note")
      .eq("chain_id", chainId)
      .eq("receipt_id", receiptId)
      .eq("sender_address", senderLower)
      .maybeSingle();

    if (error) {
      return jsonResponse(origin, 500, { error: error.message });
    }

    return jsonResponse(origin, 200, { note: data?.note ?? null });
  }

  return jsonResponse(origin, 405, { error: "Method not allowed" });
});
