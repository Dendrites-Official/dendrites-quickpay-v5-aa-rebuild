import { supabase } from "./supabaseClient";

const DEFAULT_CHAIN_ID = 84532;
const SUPABASE_FUNCTIONS_BASE = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");

export type ReceiptRecord = {
  receiptId?: string;
  userOpHash?: string;
  txHash?: string;
  chainId?: number;
  status?: string;
  success?: boolean | null;
  ownerEoa?: string | null;
  token?: string | null;
  tokenSymbol?: string | null;
  tokenDecimals?: number | null;
  title?: string | null;
  note?: string | null;
  referenceId?: string | null;
  recipientName?: string | null;
  displayName?: string | null;
  reason?: string | null;
  createdBy?: string | null;
};

type ReceiptMetaUpdate = {
  userOpHash?: string;
  txHash?: string;
  chainId?: number;
  name?: string;
  message?: string;
  reason?: string;
  referenceId?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  createdBy?: string;
};

type CreateReceiptParams = {
  chainId?: number;
  receiptId?: string;
  sender: string;
  ownerEoa: string;
  to: string;
  token: string;
  amountRaw: string;
  mode: "SPONSORED" | "SELF_PAY";
  feeMode?: string;
};

function generateReceiptId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `r_${suffix}`;
}

export async function createReceipt({
  chainId,
  receiptId,
  sender,
  ownerEoa,
  to,
  token,
  amountRaw,
  mode,
  feeMode,
}: CreateReceiptParams) {
  const resolvedId = receiptId ?? generateReceiptId();
  const payload = {
    chain_id: chainId ?? DEFAULT_CHAIN_ID,
    receipt_id: resolvedId,
    status: "created",
    sender: sender ? sender.toLowerCase() : null,
    owner_eoa: ownerEoa.toLowerCase(),
    to: to.toLowerCase(),
    token,
    amount_raw: amountRaw,
    fee_mode: feeMode ?? mode,
    fee_token_mode: mode === "SPONSORED" ? "sponsored" : "self pay",
  };

  const { data, error } = await supabase
    .from("quickpay_receipts")
    .insert(payload)
    .select("receipt_id")
    .maybeSingle();

  if (error) throw error;
  return data?.receipt_id ?? resolvedId;
}

type ListReceiptsParams = {
  limit?: number;
  wallet?: string;
};

export async function listReceipts({ limit = 50, wallet }: ListReceiptsParams) {
  let query = supabase
    .from("quickpay_receipts")
    .select(
      "id, receipt_id, status, token, token_symbol, token_decimals, amount_raw, net_amount_raw, fee_amount_raw, to, sender, owner_eoa, created_at, tx_hash, userop_hash, fee_mode, fee_token_mode, recipients_count, meta"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (wallet) {
    const address = wallet.toLowerCase();
    query = query.eq("owner_eoa", address);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

type ReceiptLookup = {
  receiptId?: string;
  userOpHash?: string;
  txHash?: string;
  chainId?: number;
};

export async function getReceiptDetail({ receiptId, userOpHash, txHash, chainId }: ReceiptLookup) {
  if (!receiptId && !userOpHash && !txHash) return null;

  let query = supabase
    .from("quickpay_receipts")
    .select("*")
    .eq("chain_id", chainId ?? DEFAULT_CHAIN_ID);

  if (receiptId) {
    query = query.eq("receipt_id", receiptId);
  } else if (userOpHash) {
    query = query.eq("userop_hash", userOpHash);
  } else if (txHash) {
    query = query.eq("tx_hash", txHash);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateReceiptMeta(receiptId: string | undefined, payload: ReceiptMetaUpdate) {
  const hasIdentifier = Boolean(receiptId || payload.userOpHash || payload.txHash);
  if (!hasIdentifier) return null;

  const updatePayload: Record<string, string | number> = {};
  if (payload.message) updatePayload.title = payload.message;
  if (payload.referenceId) updatePayload.reference_id = payload.referenceId;
  if (payload.tokenSymbol) updatePayload.token_symbol = payload.tokenSymbol;
  if (payload.tokenDecimals !== undefined) {
    updatePayload.token_decimals = payload.tokenDecimals;
  }
  if (payload.userOpHash) updatePayload.userop_hash = payload.userOpHash;
  if (payload.txHash) updatePayload.tx_hash = payload.txHash;
  if (payload.name) updatePayload.display_name = payload.name;
  if (payload.reason) updatePayload.reason = payload.reason;
  if (payload.createdBy) updatePayload.created_by = payload.createdBy;

  if (Object.keys(updatePayload).length === 0) return null;

  let query = supabase
    .from("quickpay_receipts")
    .update(updatePayload)
    .eq("chain_id", payload.chainId ?? DEFAULT_CHAIN_ID);

  if (receiptId) {
    query = query.eq("receipt_id", receiptId);
  } else if (payload.userOpHash) {
    query = query.eq("userop_hash", payload.userOpHash);
  } else if (payload.txHash) {
    query = query.eq("tx_hash", payload.txHash);
  }

  const { data, error } = await query.select().maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateReceiptStatus(receiptId: string | undefined, status: string, chainId?: number) {
  if (!receiptId) return null;
  const { data, error } = await supabase
    .from("quickpay_receipts")
    .update({ status })
    .eq("chain_id", chainId ?? DEFAULT_CHAIN_ID)
    .eq("receipt_id", receiptId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

type PrivateNoteParams = {
  receiptId: string;
  sender: string;
  signature: string;
  chainId?: number;
};

type PrivateNoteSetParams = PrivateNoteParams & { note: string };

function getFunctionsUrl(path: string) {
  if (!SUPABASE_FUNCTIONS_BASE) {
    throw new Error("Missing VITE_SUPABASE_URL");
  }
  return `${SUPABASE_FUNCTIONS_BASE}/functions/v1/${path}`;
}

export async function getPrivateNote({ receiptId, sender, signature, chainId }: PrivateNoteParams) {
  const url = new URL(getFunctionsUrl("quickpay_note"));
  url.searchParams.set("receiptId", receiptId);
  url.searchParams.set("sender", sender);
  url.searchParams.set("signature", signature);
  url.searchParams.set("chainId", String(chainId ?? DEFAULT_CHAIN_ID));

  const res = await fetch(url.toString());
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Failed to load note");
  return data as { note: string | null };
}

export async function setPrivateNote({ receiptId, sender, note, signature, chainId }: PrivateNoteSetParams) {
  const res = await fetch(getFunctionsUrl("quickpay_note"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ receiptId, sender, note, signature, chainId: chainId ?? DEFAULT_CHAIN_ID }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Failed to save note");
  return data as { ok: boolean };
}
