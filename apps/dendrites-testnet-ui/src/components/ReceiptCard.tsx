import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { formatEther, formatUnits } from "viem";
import { quickpayNoteGet, quickpayNoteSet } from "../lib/api";

type ReceiptCardProps = {
  receipt: any;
};

export default function ReceiptCard({ receipt }: ReceiptCardProps) {
  const { address, isConnected } = useAccount();
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteError, setNoteError] = useState("");
  const [privateNote, setPrivateNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const safe = receipt ?? {};
  const tokenSymbol = safe.tokenSymbol ?? safe.token_symbol ?? "";
  const tokenAddress = safe.token ?? "";
  const txHash = safe.txHash ?? safe.transactionHash ?? safe.tx_hash ?? "";
  const userOpHash = safe.userOpHash ?? safe.userop_hash ?? "";
  const receiptId = safe.receiptId ?? safe.receipt_id ?? "";
  const netRaw = safe.netAmountRaw ?? safe.net_amount_raw ?? null;
  const feeRaw = safe.feeAmountRaw ?? safe.fee_amount_raw ?? null;
  const amountRaw = safe.amountRaw ?? safe.amount_raw ?? null;
  const tokenDecimals = safe.tokenDecimals ?? safe.token_decimals ?? null;
  const feeMode = safe.feeMode ?? safe.fee_mode ?? null;
  const feeTokenMode = safe.feeTokenMode ?? safe.fee_token_mode ?? null;
  const sender = safe.sender ?? "";
  const ownerEoa = safe.ownerEoa ?? safe.owner_eoa ?? safe.createdBy ?? safe.created_by ?? "";
  const name = safe.name ?? safe.displayName ?? safe.display_name ?? "";
  const message = safe.message ?? safe.title ?? "";
  const reason = safe.reason ?? "";
  const chainId = safe.chainId ?? safe.chain_id ?? 84532;
  const lane = String(safe.lane ?? "").toUpperCase();

  const senderForNote = useMemo(() => (address ? String(address).toLowerCase() : ""), [address]);
  const receiptIdValue = String(receiptId || "");

  const buildNoteMessage = (action: "SET" | "READ") =>
    `Dendrites QuickPay Note v1\nAction: ${action}\nReceipt: ${receiptIdValue}\nSender: ${senderForNote}\nChainId: ${chainId}`;

  const loadPrivateNote = async () => {
    if (!receiptIdValue || !senderForNote) return;
    setNoteLoading(true);
    setNoteError("");
    try {
      const provider = new (await import("ethers")).ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(buildNoteMessage("READ"));
      const data = await quickpayNoteGet({ receiptId: receiptIdValue, sender: senderForNote, signature, chainId });
      setPrivateNote(data?.note ?? null);
    } catch (err: any) {
      setNoteError(err?.message || "Failed to load private note");
    } finally {
      setNoteLoading(false);
    }
  };

  const savePrivateNote = async () => {
    if (!receiptIdValue || !senderForNote || !noteDraft.trim()) return;
    setNoteLoading(true);
    setNoteError("");
    try {
      const provider = new (await import("ethers")).ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(buildNoteMessage("SET"));
      await quickpayNoteSet({ receiptId: receiptIdValue, sender: senderForNote, note: noteDraft.trim(), signature, chainId });
      setPrivateNote(noteDraft.trim());
      setNoteDraft("");
    } catch (err: any) {
      setNoteError(err?.message || "Failed to save private note");
    } finally {
      setNoteLoading(false);
    }
  };

  const copy = async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
    } catch {
      // ignore clipboard errors
    }
  };

  const shortenAddress = (value: string) => {
    if (!value || value.length < 10) return value;
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  };

  const formatWithDecimals = (raw: string | null, decimals: number | null) => {
    if (!raw) return "";
    const resolvedDecimals = decimals ?? 18;
    try {
      const formatted = formatUnits(BigInt(raw), resolvedDecimals);
      const [whole, fraction = ""] = formatted.split(".");
      if (!fraction) return whole;
      let trimmed = fraction.slice(0, 6).replace(/0+$/, "");
      if (!trimmed) return whole;
      return `${whole}.${trimmed}`;
    } catch {
      return raw;
    }
  };

  const grossRaw = amountRaw ?? (netRaw && feeRaw ? (BigInt(netRaw) + BigInt(feeRaw)).toString() : null);
  const amount = formatWithDecimals(grossRaw, tokenDecimals);
  const netAmount = formatWithDecimals(netRaw, tokenDecimals);
  const feeAmount = formatWithDecimals(feeRaw, tokenDecimals);
  const symbolLabel = tokenSymbol || "TOKEN";
  const amountLabel = amount ? `${amount} ${symbolLabel}` : "";
  const netLabel = netAmount ? `${netAmount} ${symbolLabel}` : "";
  const feeHasValue = feeRaw != null && feeRaw !== "0" && feeRaw !== "0x0";
  const receiptRaw = safe.raw ?? null;
  const rawGasUsed = receiptRaw?.gasUsed ?? receiptRaw?.receipt?.gasUsed ?? null;
  const rawGasPrice = receiptRaw?.effectiveGasPrice ?? receiptRaw?.receipt?.effectiveGasPrice ?? null;
  const gasUsed = rawGasUsed != null ? BigInt(rawGasUsed) : null;
  const gasPrice = rawGasPrice != null ? BigInt(rawGasPrice) : null;
  const gasCostWei = gasUsed != null && gasPrice != null ? gasUsed * gasPrice : null;
  const gasCostEth = gasCostWei != null ? formatEther(gasCostWei) : "";
  const normalizedFeeTokenMode = feeTokenMode ? String(feeTokenMode).toLowerCase() : "";
  const laneImpliesSponsored = ["PERMIT2", "EIP3009"].includes(lane) && !feeHasValue;
  const isSponsoredFee =
    normalizedFeeTokenMode === "sponsored" ||
    normalizedFeeTokenMode === "paymaster" ||
    (!normalizedFeeTokenMode && laneImpliesSponsored);
  const isSelfPayFee = !isSponsoredFee && !feeHasValue && Boolean(gasCostWei);
  const feeLabel = isSponsoredFee
    ? "sponsored"
    : isSelfPayFee
      ? `${gasCostEth} ETH`
      : feeAmount
        ? `${feeAmount} ${symbolLabel}`
        : "";
  const feeTokenModeLabel = isSponsoredFee
    ? "sponsored"
    : isSelfPayFee
      ? "self pay"
      : feeHasValue
        ? (feeTokenMode ?? "same")
        : "—";


  return (
    <div style={{ border: "1px solid #2a2a2a", borderRadius: 8, padding: 16, marginTop: 16 }}>
      <div><strong>Status:</strong> {String(safe.status ?? safe.success ?? "unknown")}</div>
      {receiptId ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <strong>Receipt ID:</strong>
          <span>{receiptId}</span>
          <button onClick={() => copy(receiptId)}>Copy</button>
        </div>
      ) : null}
      <div><strong>Lane:</strong> {String(safe.lane ?? "")}</div>
      <div><strong>Fee Mode:</strong> {feeMode ?? "—"}</div>
      <div><strong>Fee Token Mode:</strong> {feeTokenModeLabel}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong>Token:</strong>
        <span>{String(tokenSymbol || "TOKEN")}</span>
        {tokenAddress ? (
          <>
            <span>({shortenAddress(tokenAddress)})</span>
            <button onClick={() => copy(tokenAddress)}>Copy</button>
            <a href={`https://sepolia.basescan.org/token/${tokenAddress}`} target="_blank" rel="noreferrer">
              BaseScan
            </a>
          </>
        ) : null}
      </div>
      {safe.to ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong>To:</strong>
          <span>{shortenAddress(String(safe.to))}</span>
          <button onClick={() => copy(String(safe.to))}>Copy</button>
          <a href={`https://sepolia.basescan.org/address/${safe.to}`} target="_blank" rel="noreferrer">
            BaseScan
          </a>
        </div>
      ) : null}
      {ownerEoa ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong>From (Owner EOA):</strong>
          <span>{shortenAddress(String(ownerEoa))}</span>
          <button onClick={() => copy(String(ownerEoa))}>Copy</button>
          <a href={`https://sepolia.basescan.org/address/${ownerEoa}`} target="_blank" rel="noreferrer">
            BaseScan
          </a>
        </div>
      ) : null}
      {safe.sender ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong>From (Smart Account):</strong>
          <span>{shortenAddress(String(safe.sender))}</span>
          <button onClick={() => copy(String(safe.sender))}>Copy</button>
          <a href={`https://sepolia.basescan.org/address/${safe.sender}`} target="_blank" rel="noreferrer">
            BaseScan
          </a>
        </div>
      ) : null}
      <div><strong>Amount:</strong> {amountLabel || ""}</div>
      <div><strong>Net Amount:</strong> {netLabel || ""}</div>
      <div><strong>Fee Amount:</strong> {feeLabel || ""}</div>
      <div><strong>Fee Vault:</strong> {String(safe.feeVault ?? "")}</div>
      {txHash ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong>Tx Hash:</strong>
          <span>{shortenAddress(txHash)}</span>
          <button onClick={() => copy(txHash)}>Copy</button>
          <a href={`https://sepolia.basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer">
            BaseScan
          </a>
        </div>
      ) : null}
      {userOpHash ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong>UserOp Hash:</strong>
          <span>{shortenAddress(userOpHash)}</span>
          <button onClick={() => copy(userOpHash)}>Copy</button>
          <a href={`https://sepolia.basescan.org/tx/${userOpHash}`} target="_blank" rel="noreferrer">
            BaseScan
          </a>
        </div>
      ) : null}

      {name || message || reason ? (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Details</div>
          {name ? (
            <div style={{ marginTop: 6 }}><strong>Name:</strong> {String(name)}</div>
          ) : null}
          {message ? (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Message</div>
              <div style={{ padding: 10, border: "1px solid #2a2a2a", borderRadius: 6, whiteSpace: "pre-wrap" }}>
                {String(message)}
              </div>
            </div>
          ) : null}
          {reason ? (
            <div style={{ marginTop: 6 }}><strong>Reason:</strong> {String(reason)}</div>
          ) : null}
        </div>
      ) : null}

      <div style={{ marginTop: 12, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Private Note</div>
        {!isConnected ? (
          <div style={{ color: "#bdbdbd" }}>Connect wallet to view or save notes.</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={loadPrivateNote} disabled={noteLoading || !receiptIdValue}>
                {noteLoading ? "Loading…" : "View Note"}
              </button>
              <button onClick={savePrivateNote} disabled={noteLoading || !noteDraft.trim() || !receiptIdValue}>
                {noteLoading ? "Saving…" : "Save Note"}
              </button>
            </div>
            {noteError ? <div style={{ color: "#ff7a7a", marginTop: 8 }}>{noteError}</div> : null}
            {privateNote ? (
              <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{privateNote}</div>
            ) : null}
            <textarea
              style={{ marginTop: 8, width: "100%", minHeight: 80, padding: 8 }}
              placeholder="Write a private note"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
            />
          </>
        )}
      </div>

      <details style={{ marginTop: 12 }}>
        <summary>Raw JSON</summary>
        <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(safe, null, 2)}</pre>
      </details>
    </div>
  );
}
