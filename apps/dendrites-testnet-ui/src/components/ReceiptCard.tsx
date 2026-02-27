import { useEffect, useMemo, useState } from "react";
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
  const [showRecipients, setShowRecipients] = useState(false);
  const [autoNoteAttempted, setAutoNoteAttempted] = useState(false);

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

  // IMPORTANT: use this variable in JSX (noUnusedLocals is ON)
  const sender = safe.sender ?? "";

  const ownerEoa = safe.ownerEoa ?? safe.owner_eoa ?? safe.createdBy ?? safe.created_by ?? "";
  const name = safe.name ?? safe.displayName ?? safe.display_name ?? "";
  const message = safe.message ?? safe.title ?? "";
  const reason = safe.reason ?? "";
  const chainId = safe.chainId ?? safe.chain_id ?? 84532;

  const lane = String(safe.lane ?? "").toUpperCase();
  const recipients = Array.isArray(safe.meta?.recipients) ? safe.meta.recipients : null;
  const recipientsCount =
    safe.recipientsCount ?? safe.recipients_count ?? (recipients ? recipients.length : null);

  const metaRoute = String(safe.meta?.route ?? "").toLowerCase();
  const isAckLink = metaRoute.startsWith("acklink_");
  const ackLinkId = safe.meta?.linkId ?? safe.meta?.link_id ?? "";
  const ackKind = safe.meta?.kind ?? "";
  const ackExpiresAt = safe.meta?.expiresAt ?? null;

  useEffect(() => {
    if (!showRecipients && recipients && recipients.length > 1) {
      setShowRecipients(true);
    }
  }, [recipients, showRecipients]);

  const senderForNote = useMemo(() => (address ? String(address).toLowerCase() : ""), [address]);
  const receiptIdValue = String(receiptId || "");
  const pendingNoteKey = useMemo(
    () => (receiptIdValue ? `qp_note_pending_${receiptIdValue}` : ""),
    [receiptIdValue]
  );

  const buildNoteMessage = (action: "SET" | "READ") =>
    `Dendrites QuickPay Note v1\nAction: ${action}\nReceipt: ${receiptIdValue}\nSender: ${senderForNote}\nChainId: ${chainId}`;

  useEffect(() => {
    setAutoNoteAttempted(false);
  }, [receiptIdValue, senderForNote]);

  useEffect(() => {
    if (!isConnected || !receiptIdValue || !senderForNote || autoNoteAttempted) return;
    let cancelled = false;

    const run = async () => {
      setAutoNoteAttempted(true);
      let pendingNote = "";
      try {
        pendingNote = pendingNoteKey ? localStorage.getItem(pendingNoteKey) || "" : "";
      } catch {
        return;
      }
      if (!pendingNote || privateNote) return;

      setNoteLoading(true);
      setNoteError("");
      try {
        const { BrowserProvider } = await import("ethers");
        const provider = new BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();
        const signature = await signer.signMessage(buildNoteMessage("SET"));
        await quickpayNoteSet({
          receiptId: receiptIdValue,
          sender: senderForNote,
          note: pendingNote,
          signature,
          chainId,
        });
        if (!cancelled) {
          setPrivateNote(pendingNote);
        }
        try {
          if (pendingNoteKey) localStorage.removeItem(pendingNoteKey);
        } catch {
          // ignore localStorage failures
        }
      } catch (err: any) {
        if (!cancelled) setNoteError(err?.message || "Failed to save private note");
      } finally {
        if (!cancelled) setNoteLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [autoNoteAttempted, buildNoteMessage, chainId, isConnected, pendingNoteKey, privateNote, receiptIdValue, senderForNote]);

  const loadPrivateNote = async () => {
    if (!receiptIdValue || !senderForNote) return;
    setNoteLoading(true);
    setNoteError("");
    try {
      const { BrowserProvider } = await import("ethers");
      const provider = new BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(buildNoteMessage("READ"));
      const data = await quickpayNoteGet({
        receiptId: receiptIdValue,
        sender: senderForNote,
        signature,
        chainId,
      });
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
      const { BrowserProvider } = await import("ethers");
      const provider = new BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(buildNoteMessage("SET"));
      await quickpayNoteSet({
        receiptId: receiptIdValue,
        sender: senderForNote,
        note: noteDraft.trim(),
        signature,
        chainId,
      });
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
      // ignore
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
      const trimmed = fraction.slice(0, 6).replace(/0+$/, "");
      return trimmed ? `${whole}.${trimmed}` : whole;
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

  const statusText = String(safe.status ?? safe.success ?? "unknown");
  const statusLower = statusText.toLowerCase();
  const isOk = ["success", "succeeded", "confirmed", "finalized", "complete", "completed"].includes(statusLower);
  const isBad = ["failed", "reverted", "error"].includes(statusLower);
  const statusChipClass = isOk ? "dx-chip dx-chipOk" : isBad ? "dx-chip dx-chipBad" : "dx-chip dx-chipWarn";

  return (
    <section className="dx-card" style={{ marginTop: 14 }}>
      <div className="dx-card-in">
        <div className="dx-card-head">
          <h2 className="dx-card-title">Receipt</h2>
          <span className={statusChipClass}>{statusText}</span>
        </div>

        <div className="dx-section">
          <div className="dx-kv">
            {receiptId ? (
              <>
                <div className="dx-k">Receipt ID</div>
                <div className="dx-v">
                  <div className="dx-rowInline">
                    <span className="dx-mono">{receiptId}</span>
                    <button className="dx-copyBtn" onClick={() => copy(receiptId)}>Copy</button>
                  </div>
                </div>
              </>
            ) : null}

            <div className="dx-k">Lane</div>
            <div className="dx-v">
              <span className="dx-chip dx-chipBlue">{String(safe.lane ?? "") || "—"}</span>
            </div>

            <div className="dx-k">Fee mode</div>
            <div className="dx-v">{feeMode ?? "—"}</div>

            <div className="dx-k">Fee token mode</div>
            <div className="dx-v">{feeTokenModeLabel}</div>

            <div className="dx-k">Token</div>
            <div className="dx-v">
              <div className="dx-rowInline">
                <span className="dx-chip">{String(tokenSymbol || "TOKEN")}</span>
                {tokenAddress ? <span className="dx-muted">({shortenAddress(tokenAddress)})</span> : null}
                {tokenAddress ? (
                  <>
                    <button className="dx-copyBtn" onClick={() => copy(tokenAddress)}>Copy</button>
                    <a className="dx-linkBtn" href={`https://sepolia.basescan.org/token/${tokenAddress}`} target="_blank" rel="noreferrer">
                      BaseScan
                    </a>
                  </>
                ) : null}
              </div>
            </div>

            {safe.to ? (
              <>
                <div className="dx-k">To</div>
                <div className="dx-v">
                  <div className="dx-rowInline">
                    <span className="dx-mono">{shortenAddress(String(safe.to))}</span>
                    <button className="dx-copyBtn" onClick={() => copy(String(safe.to))}>Copy</button>
                    <a className="dx-linkBtn" href={`https://sepolia.basescan.org/address/${safe.to}`} target="_blank" rel="noreferrer">
                      BaseScan
                    </a>
                  </div>
                </div>
              </>
            ) : null}

            {ownerEoa ? (
              <>
                <div className="dx-k">From (Owner EOA)</div>
                <div className="dx-v">
                  <div className="dx-rowInline">
                    <span className="dx-mono">{shortenAddress(String(ownerEoa))}</span>
                    <button className="dx-copyBtn" onClick={() => copy(String(ownerEoa))}>Copy</button>
                    <a className="dx-linkBtn" href={`https://sepolia.basescan.org/address/${ownerEoa}`} target="_blank" rel="noreferrer">
                      BaseScan
                    </a>
                  </div>
                </div>
              </>
            ) : null}

            {sender ? (
              <>
                <div className="dx-k">From (Smart Account)</div>
                <div className="dx-v">
                  <div className="dx-rowInline">
                    <span className="dx-mono">{shortenAddress(String(sender))}</span>
                    <button className="dx-copyBtn" onClick={() => copy(String(sender))}>Copy</button>
                    <a className="dx-linkBtn" href={`https://sepolia.basescan.org/address/${sender}`} target="_blank" rel="noreferrer">
                      BaseScan
                    </a>
                  </div>
                </div>
              </>
            ) : null}

            <div className="dx-k">Amount</div>
            <div className="dx-v">{amountLabel || "—"}</div>

            <div className="dx-k">Net amount</div>
            <div className="dx-v">{netLabel || "—"}</div>

            <div className="dx-k">Fee</div>
            <div className="dx-v">{feeLabel || "—"}</div>

            <div className="dx-k">Fee vault</div>
            <div className="dx-v">{String(safe.feeVault ?? "") || "—"}</div>

            {txHash ? (
              <>
                <div className="dx-k">Tx hash</div>
                <div className="dx-v">
                  <div className="dx-rowInline">
                    <span className="dx-mono">{shortenAddress(txHash)}</span>
                    <button className="dx-copyBtn" onClick={() => copy(txHash)}>Copy</button>
                    <a className="dx-linkBtn" href={`https://sepolia.basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer">
                      BaseScan
                    </a>
                  </div>
                </div>
              </>
            ) : null}

            {userOpHash ? (
              <>
                <div className="dx-k">UserOp hash</div>
                <div className="dx-v">
                  <div className="dx-rowInline">
                    <span className="dx-mono">{shortenAddress(userOpHash)}</span>
                    <button className="dx-copyBtn" onClick={() => copy(userOpHash)}>Copy</button>
                    <a className="dx-linkBtn" href={`https://sepolia.basescan.org/tx/${userOpHash}`} target="_blank" rel="noreferrer">
                      BaseScan
                    </a>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>

        {isAckLink ? (
          <div className="dx-section" style={{ marginTop: 12 }}>
            <div className="dx-card-head" style={{ marginBottom: 8 }}>
              <h3 className="dx-card-title">AckLink</h3>
              <span className="dx-chip">{String(ackKind || metaRoute || "AckLink")}</span>
            </div>

            {ackLinkId ? (
              <div className="dx-rowInline" style={{ marginTop: 6 }}>
                <span className="dx-muted">Link ID:</span>
                <span className="dx-mono">{ackLinkId}</span>
                <button className="dx-copyBtn" onClick={() => copy(String(ackLinkId))}>Copy</button>
                <a className="dx-linkBtn" href={`/ack/${ackLinkId}`} target="_blank" rel="noreferrer">Open AckLink</a>
              </div>
            ) : null}

            {ackExpiresAt ? <div style={{ marginTop: 8 }} className="dx-muted">Expires: {String(ackExpiresAt)}</div> : null}
          </div>
        ) : null}

        {name || message || reason ? (
          <div className="dx-section" style={{ marginTop: 12 }}>
            <div className="dx-card-head" style={{ marginBottom: 8 }}>
              <h3 className="dx-card-title">Details</h3>
              <p className="dx-card-hint">Optional metadata</p>
            </div>

            {name ? (
              <div className="dx-kv">
                <div className="dx-k">Name</div>
                <div className="dx-v">{String(name)}</div>
              </div>
            ) : null}

            {reason ? (
              <div className="dx-kv" style={{ marginTop: 10 }}>
                <div className="dx-k">Reason</div>
                <div className="dx-v">{String(reason)}</div>
              </div>
            ) : null}

            {message ? (
              <div style={{ marginTop: 10 }}>
                <div className="dx-k" style={{ marginBottom: 6 }}>Message</div>
                <div className="dx-codeBox">{String(message)}</div>
              </div>
            ) : null}
          </div>
        ) : null}

        {recipientsCount ? (
          <div className="dx-section" style={{ marginTop: 12 }}>
            <div className="dx-card-head" style={{ marginBottom: 8 }}>
              <h3 className="dx-card-title">Recipients</h3>
              <div className="dx-rowInline">
                <span className="dx-chip">{Number(recipientsCount)} total</span>
                {recipients?.length ? (
                  <button className="dx-copyBtn" onClick={() => setShowRecipients((prev) => !prev)}>
                    {showRecipients ? "Hide" : "Show"}
                  </button>
                ) : null}
              </div>
            </div>

            {recipients?.length && showRecipients ? (
              <div style={{ display: "grid", gap: 8 }}>
                {recipients.map((entry: any, idx: number) => (
                  <div key={`${entry?.to ?? entry?.address ?? idx}`} className="dx-section" style={{ padding: 10, borderRadius: 14 }}>
                    <div className="dx-rowInline" style={{ justifyContent: "space-between" }}>
                      <span className="dx-mono">{shortenAddress(String(entry?.to ?? entry?.address ?? ""))}</span>
                      <span className="dx-muted">
                        {entry?.amount ? `${formatWithDecimals(String(entry.amount), tokenDecimals)} ${symbolLabel}` : "-"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="dx-muted">Recipient details not available yet.</div>
            )}
          </div>
        ) : null}

        <div className="dx-section" style={{ marginTop: 12 }}>
          <div className="dx-card-head" style={{ marginBottom: 8 }}>
            <h3 className="dx-card-title">Private note</h3>
            <p className="dx-card-hint">Signed read/write</p>
          </div>

          {!isConnected ? (
            <div className="dx-alert">Connect wallet to view or save notes.</div>
          ) : (
            <>
              <div className="dx-btnRow">
                <button className="dx-primary" onClick={loadPrivateNote} disabled={noteLoading || !receiptIdValue}>
                  {noteLoading ? "Loading…" : "View Note"}
                </button>
                <button onClick={savePrivateNote} disabled={noteLoading || !noteDraft.trim() || !receiptIdValue}>
                  {noteLoading ? "Saving…" : "Save Note"}
                </button>
              </div>

              {noteError ? <div className="dx-alert dx-alert-danger" style={{ marginTop: 10 }}>{noteError}</div> : null}

              {privateNote ? <div className="dx-codeBox" style={{ marginTop: 10 }}>{privateNote}</div> : null}

              <textarea
                className="dx-textarea"
                placeholder="Write a private note"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
              />
            </>
          )}
        </div>

        <details style={{ marginTop: 12 }}>
          <summary className="dx-muted">Raw JSON</summary>
          <pre className="dx-codeBox">{JSON.stringify(safe, null, 2)}</pre>
        </details>
      </div>
    </section>
  );
}
