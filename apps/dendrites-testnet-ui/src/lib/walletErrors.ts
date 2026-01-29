type NormalizedError = {
  message: string;
  details: string | null;
};

export function normalizeWalletError(err: any): NormalizedError {
  const code = String(err?.code || "");
  const message = String(err?.message || err || "");
  const lower = message.toLowerCase();

  if (code === "ACTION_REJECTED" || lower.includes("user rejected") || lower.includes("rejected")) {
    return { message: "Transaction rejected in wallet.", details: message };
  }
  if (lower.includes("insufficient funds")) {
    return { message: "Insufficient funds for gas.", details: message };
  }
  if (lower.includes("nonce too low")) {
    return { message: "Nonce too low. A newer transaction likely replaced this.", details: message };
  }
  if (
    lower.includes("replacement underpriced") ||
    lower.includes("fee too low") ||
    lower.includes("max fee per gas too low")
  ) {
    return { message: "Replacement fee too low. Increase fees and retry.", details: message };
  }
  if (lower.includes("already known") || lower.includes("already imported") || lower.includes("already mined")) {
    return { message: "Transaction already known or mined.", details: message };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return { message: "RPC timeout. Please retry.", details: message };
  }

  return { message: "Transaction failed.", details: message || null };
}
