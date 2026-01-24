import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount, useSignMessage } from "wagmi";
import { ethers } from "ethers";
import ReceiptCard from "../components/ReceiptCard";
import { quickpaySend } from "../lib/api";
import { createReceipt, setPrivateNote, updateReceiptMeta, updateReceiptStatus } from "../lib/receiptsApi";

export default function QuickPay() {
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [token, setToken] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [reason, setReason] = useState("");
  const [speed, setSpeed] = useState<0 | 1>(0);
  const [mode, setMode] = useState<"SPONSORED" | "SELF_PAY">("SPONSORED");
  const [quote, setQuote] = useState<any>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [quoteAuthSignature, setQuoteAuthSignature] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<any>(null);

  const isValidAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value);
  const amountValid = useMemo(() => {
    try {
      const isUsdc = token.toLowerCase() === "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
      const tokenDecimals = isUsdc ? 6 : 18;
      return ethers.parseUnits(amount, tokenDecimals) > 0n;
    } catch {
      return false;
    }
  }, [amount, token]);

  const feeMode = speed === 1 ? "instant" : "eco";
  const quoteUrl = useMemo(() => {
    const base = String(import.meta.env.VITE_QUICKPAY_SEND_URL ?? "").trim();
    if (!base) return "";
    return base.replace(/\/send$/i, "/quote");
  }, []);

  const getQuote = async () => {
    if (!address) {
      setQuoteError("Connect wallet first.");
      return;
    }
    if (!isValidAddress(token) || !isValidAddress(to) || !amountValid) {
      setQuoteError("Enter valid token, recipient, and amount.");
      return;
    }
    if (!quoteUrl) {
      setQuoteError("Missing VITE_QUICKPAY_SEND_URL");
      return;
    }
    setQuoteLoading(true);
    setQuoteError("");
    setQuote(null);
    try {
      const isUsdc = token.toLowerCase() === "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
      const tokenDecimals = isUsdc ? 6 : 18;
      const amountRaw = ethers.parseUnits(amount, tokenDecimals).toString();
      const authMessage = mode === "SPONSORED"
        ? isUsdc
          ? "Dendrites QuickPay EIP-3009 authorization"
          : "Dendrites QuickPay Permit2 authorization"
        : "Dendrites QuickPay quote authorization";
      const sig = await signMessageAsync({ message: authMessage });
      setQuoteAuthSignature(sig);

      const res = await fetch(quoteUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromEoa: address,
          token,
          to,
          amount: amountRaw,
          feeMode,
          speed,
          mode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to get quote");
      setQuote(data);
    } catch (err: any) {
      setQuoteError(err?.message || "Failed to get quote");
    } finally {
      setQuoteLoading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    if (!quote) {
      setError("Get a quote before sending.");
      return;
    }
    if (!isValidAddress(token) || !isValidAddress(to) || !amountValid) {
      setError("Enter valid token, recipient, and amount.");
      return;
    }
    setLoading(true);
    setError("");
    setReceipt(null);
    let receiptId: string | null = null;
    try {
      const chainId = 84532;
      const senderLower = address.toLowerCase();

      if (mode === "SPONSORED") {
        await signMessageAsync({ message: "Dendrites QuickPay send authorization" });
      } else {
        await signMessageAsync({ message: "Dendrites QuickPay self-pay authorization" });
      }

      const isUsdc = token.toLowerCase() === "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
      const tokenDecimals = isUsdc ? 6 : 18;
      const amountRaw = ethers.parseUnits(amount, tokenDecimals).toString();

      receiptId = await createReceipt({
        chainId,
        sender: senderLower,
        ownerEoa: senderLower,
        to,
        token,
        amountRaw,
        mode,
      });

      await updateReceiptMeta(receiptId ?? undefined, {
        name: displayName.trim() || undefined,
        message: message.trim() || undefined,
        reason: reason.trim() || undefined,
        chainId,
      });

      if (receiptId && note.trim()) {
        const noteMessage =
          `Dendrites QuickPay Note v1\n` +
          `Action: SET\n` +
          `Receipt: ${receiptId}\n` +
          `Sender: ${senderLower}\n` +
          `ChainId: ${chainId}`;
        const signature = await signMessageAsync({ message: noteMessage });
        await setPrivateNote({ receiptId, sender: senderLower, note: note.trim(), signature, chainId });
      }

      const data = await quickpaySend({
        fromEoa: senderLower,
        to,
        token,
        amount: amountRaw,
        mode,
        speed,
        feeMode,
        receiptId,
        chainId,
        quotedFeeTokenAmount: quote?.feeTokenAmount,
        quoteAuthSignature,
      });
      const userOpHash = data?.userOpHash || data?.userOp?.userOpHash;
      const txHash = data?.txHash ?? data?.tx_hash ?? null;

      updateReceiptMeta(receiptId ?? undefined, {
        userOpHash: userOpHash ?? undefined,
        txHash: txHash ?? undefined,
        chainId,
      }).catch(() => undefined);

      if (receiptId) {
        navigate(`/r/${receiptId}`);
        return;
      }
      if (userOpHash) {
        navigate(`/receipts?uop=${userOpHash}`);
        return;
      }
      if (txHash) {
        navigate(`/receipts?tx=${txHash}`);
        return;
      }
      if (data) setReceipt(data);
    } catch (err: any) {
      setError(err?.message || "Failed to send");
      if (receiptId) {
        updateReceiptStatus(receiptId, "FAILED").catch(() => undefined);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>QuickPay</h2>
      <form onSubmit={submit} style={{ marginTop: 16, display: "grid", gap: 8, maxWidth: 520 }}>
        <input
          style={{ padding: 8 }}
          placeholder="Token address"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <input
          style={{ padding: 8 }}
          placeholder="Recipient address"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <input
          style={{ padding: 8 }}
          placeholder="Amount (raw units)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          style={{ padding: 8 }}
          placeholder="Name (optional)"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <label style={{ display: "grid", gap: 6 }}>
          <span>Message (optional)</span>
          <textarea
            style={{ padding: 8, minHeight: 96 }}
            placeholder="Add a message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <input
          style={{ padding: 8 }}
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <label style={{ display: "grid", gap: 6 }}>
          <span>Note (optional)</span>
          <textarea
            style={{ padding: 8, minHeight: 96 }}
            placeholder="Private note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          Speed:
          <select value={speed} onChange={(e) => setSpeed(e.target.value === "1" ? 1 : 0)}>
            <option value={0}>Eco</option>
            <option value={1}>Instant</option>
          </select>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          Mode:
          <select value={mode} onChange={(e) => setMode(e.target.value as "SPONSORED" | "SELF_PAY")}>
            <option value="SPONSORED">SPONSORED</option>
            <option value="SELF_PAY">SELF_PAY</option>
          </select>
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={getQuote} disabled={quoteLoading || !isConnected}>
            {quoteLoading ? "Quoting..." : "Get Quote"}
          </button>
          <button type="submit" disabled={loading || !isConnected || !quote}>
            {loading ? "Sending..." : "Send"}
          </button>
        </div>
        {!isConnected ? (
          <div style={{ color: "#bdbdbd" }}>Connect wallet first.</div>
        ) : null}
      </form>

      {quoteError ? <div style={{ color: "#ff7a7a", marginTop: 8 }}>{quoteError}</div> : null}
      {quote ? (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 520 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Quote</div>
          <div><strong>Lane:</strong> {quote.lane ?? "—"}</div>
          <div><strong>Sponsored:</strong> {quote.sponsored ? "Yes" : "No"}</div>
          <div><strong>Fee (token units):</strong> {quote.feeTokenAmount ?? "0"}</div>
          <div><strong>Net (token units):</strong> {quote.netAmount ?? "0"}</div>
          <div><strong>Fee USD6:</strong> {quote.feeUsd6 ?? "0"}</div>
        </div>
      ) : null}

      {error ? <div style={{ color: "#ff7a7a", marginTop: 8 }}>{error}</div> : null}
      {receipt ? <ReceiptCard receipt={receipt} /> : null}
    </div>
  );
}
