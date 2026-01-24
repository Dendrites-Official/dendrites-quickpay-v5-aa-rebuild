import { supabase } from "./supabaseClient";
import { qpUrl } from "./quickpayApiBase";

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
}) {
  const { data, error } = await supabase.functions.invoke("quickpay_note", {
    body: payload,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function quickpayNoteGet(params: {
  receiptId: string;
  sender: string;
  signature: string;
}) {
  const { data, error } = await supabase.functions.invoke("quickpay_note", {
    method: "GET",
    body: params,
  });
  if (error) throw new Error(error.message);
  return data;
}
