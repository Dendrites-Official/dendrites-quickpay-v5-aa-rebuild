import { supabase } from "./supabaseClient";
import { qpUrl } from "./quickpayApiBase";

const SUPABASE_FUNCTIONS_BASE = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");

function getFunctionsUrl(path: string) {
  if (!SUPABASE_FUNCTIONS_BASE) {
    throw new Error("Missing VITE_SUPABASE_URL");
  }
  return `${SUPABASE_FUNCTIONS_BASE}/functions/v1/${path}`;
}

type QuickpayReceiptRequest = {
  chainId?: number;
  receiptId?: string;
  userOpHash?: string;
  txHash?: string;
};

export async function quickpayReceipt(payload: QuickpayReceiptRequest) {
  const { data, error } = await supabase.functions.invoke("quickpay_receipt", {
    body: payload,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function quickpaySend(payload: {
  fromEoa: string;
  token: string;
  to: string;
  amount: string;
  mode: "SPONSORED" | "SELF_PAY";
  speed: 0 | 1;
  receiptId: string;
  chainId?: number;
  feeMode?: string;
  quotedFeeTokenAmount?: string;
  authSignature?: string | null;
  quoteAuthSignature?: string | null;
  permit2Signature?: string | null;
  eip3009Signature?: string | null;
}) {
  const res = await fetch(qpUrl("/send"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to send");
  return data;
}

export async function quickpayNoteSet(payload: {
  receiptId: string;
  sender: string;
  note: string;
  signature: string;
  chainId?: number;
}) {
  const res = await fetch(getFunctionsUrl("quickpay_note"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Failed to save note");
  return data;
}

export async function quickpayNoteGet(params: {
  receiptId: string;
  sender: string;
  signature: string;
  chainId?: number;
}) {
  const url = new URL(getFunctionsUrl("quickpay_note"));
  url.searchParams.set("receiptId", params.receiptId);
  url.searchParams.set("sender", params.sender);
  url.searchParams.set("signature", params.signature);
  if (params.chainId != null) url.searchParams.set("chainId", String(params.chainId));
  const res = await fetch(url.toString(), { method: "GET" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Failed to load note");
  return data;
}

export async function acklinkCreate(payload: {
  from: string;
  amountUsdc6: string;
  speed: "eco" | "instant";
  auth?: {
    from: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
    v: number;
    r: string;
    s: string;
  } | null;
  name?: string | null;
  message?: string | null;
  reason?: string | null;
  note?: string | null;
  noteSignature?: string | null;
  noteSender?: string | null;
  userOpSignature?: string | null;
  userOpDraft?: any;
}) {
  const res = await fetch(qpUrl("/acklink/create"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.code || "Failed to create AckLink");
  return data;
}

export async function acklinkGet(linkId: string) {
  const res = await fetch(qpUrl(`/acklink/${linkId}`));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.code || "Failed to load AckLink");
  return data;
}

export async function acklinkClaim(payload: {
  linkId: string;
  claimer: string;
  note?: string | null;
  noteSignature?: string | null;
  noteSender?: string | null;
  userOpSignature?: string | null;
  userOpDraft?: any;
}) {
  const res = await fetch(qpUrl("/acklink/claim"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.code || "Failed to claim AckLink");
  return data;
}

export async function acklinkRefund(payload: {
  linkId: string;
  requester: string;
  userOpSignature?: string | null;
  userOpDraft?: any;
}) {
  const res = await fetch(qpUrl("/acklink/refund"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.code || "Failed to refund AckLink");
  return data;
}
