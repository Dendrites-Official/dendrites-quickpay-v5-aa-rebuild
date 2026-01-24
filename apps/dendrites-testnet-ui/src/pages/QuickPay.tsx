import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount, useSignMessage, useSignTypedData } from "wagmi";
import { ethers } from "ethers";
import ReceiptCard from "../components/ReceiptCard";
import { quickpaySend } from "../lib/api";
import { createReceipt, setPrivateNote, updateReceiptMeta, updateReceiptStatus } from "../lib/receiptsApi";

export default function QuickPay() {
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { signTypedDataAsync } = useSignTypedData();
  const [token, setToken] = useState("");
  const [tokenPreset, setTokenPreset] = useState("custom");
  const [decimals, setDecimals] = useState(18);
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
  const [quotePending, setQuotePending] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const quoteAbortRef = useRef<AbortController | null>(null);
  const quoteDebounceRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<any>(null);

  const isValidAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value);
  const amountValid = useMemo(() => {
    try {
      return ethers.parseUnits(amount, decimals) > 0n;
    } catch {
      return false;
    }
  }, [amount, decimals]);

  const mdndxToken = String(import.meta.env.VITE_MDNDX ?? "").trim();
  const tokenOptions = useMemo(
    () => [
      {
        value: "usdc",
        label: "USDC (Base Sepolia)",
        address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        decimals: 6,
      },
      {
        value: "weth",
        label: "WETH (Base Sepolia)",
        address: "",
        decimals: 18,
      },
      {
        value: "aero",
        label: "AERO",
        address: "",
        decimals: 18,
      },
      {
        value: "mdndx",
        label: "mDNDX",
        address: mdndxToken,
        decimals: 18,
      },
      {
        value: "custom",
        label: "Custom",
        address: "",
        decimals: 18,
      },
    ],
    [mdndxToken]
  );

  const selectedTokenPreset = tokenOptions.find((option) => option.value === tokenPreset);
  const isCustomToken = selectedTokenPreset?.value === "custom";
  const tokenLocked = !isCustomToken && Boolean(selectedTokenPreset?.address);
  const decimalsLocked = !isCustomToken;

  const feeMode = speed === 1 ? "instant" : "eco";
  const apiBase = String(import.meta.env.VITE_QUICKPAY_SEND_URL ?? "").trim();
  if (!apiBase) {
    throw new Error("Missing VITE_QUICKPAY_SEND_URL");
  }
  const quoteUrl = useMemo(() => `${apiBase.replace(/\/$/, "")}/quote`, [apiBase]);
  const quoteBusy = quotePending || quoteLoading;

  const getQuote = async (signal?: AbortSignal) => {
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
    setQuotePending(false);
    setQuoteError("");
    setQuote(null);
    try {
      const amountRaw = ethers.parseUnits(amount, decimals).toString();
      const speedLabel = speed === 1 ? "instant" : "eco";
      const body = {
        chainId: 84532,
        ownerEoa: address,
        token,
        to,
        amount: amountRaw,
        feeMode: "same",
        speed: speedLabel,
        mode,
      };
      console.log("QUOTE_BODY", body);

      const res = await fetch(quoteUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 400) {
        throw new Error(JSON.stringify(data));
      }
      if (data?.ok === false) {
        throw new Error(JSON.stringify(data));
      }
      if (!res.ok) throw new Error(data?.error || "Failed to get quote");
      setQuote(data);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setQuoteError(err?.message || "Failed to get quote");
    } finally {
      if (!signal?.aborted) {
        setQuoteLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!isConnected || !address) {
      quoteAbortRef.current?.abort();
      setQuotePending(false);
      setQuoteLoading(false);
      return;
    }
    if (!isValidAddress(token) || !isValidAddress(to) || !amountValid) {
      quoteAbortRef.current?.abort();
      setQuotePending(false);
      setQuoteLoading(false);
      return;
    }

    if (quoteDebounceRef.current) {
      window.clearTimeout(quoteDebounceRef.current);
    }

    quoteDebounceRef.current = window.setTimeout(() => {
      quoteAbortRef.current?.abort();
      const controller = new AbortController();
      quoteAbortRef.current = controller;
      getQuote(controller.signal);
    }, 400);
    setQuotePending(true);

    return () => {
      if (quoteDebounceRef.current) {
        window.clearTimeout(quoteDebounceRef.current);
      }
    };
  }, [address, amount, amountValid, decimals, isConnected, mode, speed, to, token]);

  useEffect(() => {
    return () => {
      quoteAbortRef.current?.abort();
    };
  }, []);

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

      const isUsdc = token.toLowerCase() === "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
      const amountRaw = ethers.parseUnits(amount, decimals).toString();
      let auth: any = null;
      if (mode === "SPONSORED" && isUsdc) {
        const now = Math.floor(Date.now() / 1000);
        const validAfter = 0;
        const validBefore = now + 60 * 30;
        const nonce = ethers.hexlify(ethers.randomBytes(32));
        const typedData = {
          domain: {
            name: "USD Coin",
            version: "2",
            chainId,
            verifyingContract: token,
          },
          types: {
            ReceiveWithAuthorization: [
              { name: "from", type: "address" },
              { name: "to", type: "address" },
              { name: "value", type: "uint256" },
              { name: "validAfter", type: "uint256" },
              { name: "validBefore", type: "uint256" },
              { name: "nonce", type: "bytes32" },
            ],
          },
          primaryType: "ReceiveWithAuthorization",
          message: {
            from: senderLower,
            to,
            value: amountRaw,
            validAfter,
            validBefore,
            nonce,
          },
        } as const;
        const signature = await signTypedDataAsync(typedData);
        auth = { type: "EIP3009", ...typedData.message, signature };
      }

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

      const sendPayload: any = {
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
        auth,
      };
      const data = await quickpaySend(sendPayload);
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
        <label style={{ display: "grid", gap: 6 }}>
          <span>Token</span>
          <select
            value={tokenPreset}
            onChange={(e) => {
              const nextPreset = e.target.value;
              setTokenPreset(nextPreset);
              const selected = tokenOptions.find((option) => option.value === nextPreset);
              if (!selected) return;
              if (selected.value === "custom") {
                setDecimals(18);
                return;
              }
              setToken(selected.address || "");
              setDecimals(selected.decimals ?? 18);
            }}
          >
            {tokenOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <input
          style={{ padding: 8 }}
          placeholder="Token address"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          readOnly={tokenLocked}
        />
        <label style={{ display: "grid", gap: 6 }}>
          <span>Decimals</span>
          <input
            style={{ padding: 8 }}
            type="number"
            min={0}
            max={36}
            value={decimals}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              setDecimals(Math.max(0, Math.min(36, Math.trunc(next))));
            }}
            readOnly={decimalsLocked}
          />
        </label>
        <input
          style={{ padding: 8 }}
          placeholder="Recipient address"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <label style={{ display: "grid", gap: 6 }}>
          <span>Amount</span>
          <input
            style={{ padding: 8 }}
            placeholder="e.g. 1.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <small style={{ color: "#9aa0a6" }}>We convert to raw units automatically</small>
        </label>
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
          <button type="submit" disabled={loading || !isConnected || !quote}>
            {loading ? "Sending..." : "Send"}
          </button>
        </div>
        {!isConnected ? (
          <div style={{ color: "#bdbdbd" }}>Connect wallet first.</div>
        ) : null}
      </form>

      {quoteBusy ? <div style={{ color: "#bdbdbd", marginTop: 8 }}>Quote: loading…</div> : null}
      {quoteError ? <div style={{ color: "#ff7a7a", marginTop: 8 }}>{quoteError}</div> : null}
      {quote ? (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 520 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Quote</div>
          <div><strong>Lane:</strong> {quote.lane ?? "—"}</div>
          <div><strong>Sponsored:</strong> {quote.sponsored ? "Yes" : "No"}</div>
          <div>
            <strong>Fee USD:</strong>{" "}
            {token.toLowerCase() === "0x036cbd53842c5426634e7929541ec2318f3dcf7e" && decimals === 6
              ? (Number(quote.feeUsd6 ?? 0) / 1e6).toFixed(6)
              : quote.feeUsd6 ?? "0"}
          </div>
          <div>
            <strong>Fee token:</strong>{" "}
            {quote.feeTokenAmount ? ethers.formatUnits(quote.feeTokenAmount, decimals) : "0"}
          </div>
          <div>
            <strong>Net token:</strong>{" "}
            {quote.netAmount ? ethers.formatUnits(quote.netAmount, decimals) : "0"}
          </div>
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer" }}>Raw details</summary>
            <div style={{ marginTop: 6, fontSize: 12, color: "#bdbdbd" }}>
              <div>feeUsd6: {quote.feeUsd6 ?? "0"}</div>
              <div>feeTokenAmount: {quote.feeTokenAmount ?? "0"}</div>
              <div>netAmount: {quote.netAmount ?? "0"}</div>
              <div>feeMode: {quote.feeMode ?? "—"}</div>
              <div>speed: {quote.speed ?? "—"}</div>
            </div>
          </details>
        </div>
      ) : null}

      {error ? <div style={{ color: "#ff7a7a", marginTop: 8 }}>{error}</div> : null}
      {receipt ? <ReceiptCard receipt={receipt} /> : null}
    </div>
  );
}
