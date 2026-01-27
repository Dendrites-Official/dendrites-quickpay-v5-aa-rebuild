import { supabase } from "./supabaseClient";

const DEFAULT_CHAIN_ID = 84532;

type ReceiptNotePayload = {
  userWallet?: string;
  chainId?: number;
  userOpHash?: string;
  txHash?: string;
  title?: string;
  note?: string;
  referenceId?: string;
  toAddress?: string;
  tokenAddress?: string;
  amountRaw?: string;
};

export async function saveReceiptNote(payload: ReceiptNotePayload) {
  const userWallet = payload.userWallet?.toLowerCase();
  if (!userWallet) return null;

  const insertPayload = {
    user_wallet: userWallet,
    chain_id: payload.chainId ?? DEFAULT_CHAIN_ID,
    userop_hash: payload.userOpHash ?? null,
    tx_hash: payload.txHash ?? null,
    title: payload.title ?? null,
    note: payload.note ?? null,
    reference_id: payload.referenceId ?? null,
    to_address: payload.toAddress ?? null,
    token_address: payload.tokenAddress ?? null,
    amount_raw: payload.amountRaw ?? null,
  };

  const { data, error } = await supabase.from("receipt_notes").insert(insertPayload).select().maybeSingle();
  if (error) throw error;
  return data;
}

type ReceiptNoteLookup = {
  userOpHash?: string;
  txHash?: string;
  chainId?: number;
};

export async function getReceiptNote({ userOpHash, txHash, chainId }: ReceiptNoteLookup) {
  if (!userOpHash && !txHash) return null;

  let query = supabase.from("receipt_notes").select("*").eq("chain_id", chainId ?? DEFAULT_CHAIN_ID);

  if (userOpHash && txHash) {
    query = query.or(`userop_hash.eq.${userOpHash},tx_hash.eq.${txHash}`);
  } else if (userOpHash) {
    query = query.eq("userop_hash", userOpHash);
  } else if (txHash) {
    query = query.eq("tx_hash", txHash);
  }

  const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}
