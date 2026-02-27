import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount, usePublicClient, useSignTypedData } from "wagmi";
import { ethers } from "ethers";
import { qpUrl } from "../lib/quickpayApiBase";
import { getQuickPayChainConfig } from "../lib/quickpayChainConfig";
import { logAppEvent } from "../lib/appEvents";
import { quickpayNoteSet } from "../lib/api";

const USDC_DEFAULT = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DECIMALS = 6;

function parseLine(line: string) {
  const parts = line
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return { address: parts[0], amount: parts[1] };
}

export default function BulkPay() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: 84532 });
  const { signTypedDataAsync } = useSignTypedData();
  const navigate = useNavigate();
  const [speed, setSpeed] = useState<0 | 1>(1);
  const [amountMode, setAmountMode] = useState<"net" | "plusFee">("plusFee");
  const [recipientsInput, setRecipientsInput] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);
  const [bulkNotConfigured, setBulkNotConfigured] = useState(false);
  const [balanceError, setBalanceError] = useState("");

  const usdcAddress = String(import.meta.env.VITE_USDC_ADDRESS || USDC_DEFAULT).trim();
  const speedLabel = speed === 0 ? "eco" : "instant";

  const parsed = useMemo(() => {
    const lines = recipientsInput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const entries: { address: string; amount: string; amountRaw: string }[] = [];
    const errors: string[] = [];
    let total = 0n;

    lines.forEach((line, idx) => {
      const parsedLine = parseLine(line);
      if (!parsedLine) {
        errors.push(`Line ${idx + 1}: Expected "address,amount"`);
        return;
      }
      const { address: addr, amount } = parsedLine;
      if (!ethers.isAddress(addr)) {
        errors.push(`Line ${idx + 1}: Invalid address`);
        return;
      }
      try {
        const raw = ethers.parseUnits(amount, DECIMALS);
        if (raw <= 0n) {
          errors.push(`Line ${idx + 1}: Amount must be > 0`);
          return;
        }
        total += raw;
        entries.push({ address: ethers.getAddress(addr), amount, amountRaw: raw.toString() });
      } catch {
        errors.push(`Line ${idx + 1}: Invalid amount`);
      }
    });

    return { entries, errors, totalNet: total };
  }, [recipientsInput]);

  const totalNetDisplay = useMemo(() => {
    if (parsed.totalNet <= 0n) return "0";
    return ethers.formatUnits(parsed.totalNet, DECIMALS);
  }, [parsed.totalNet]);

  const feeAmountRaw = useMemo(() => {
    const raw = quote?.feeTokenAmount ?? quote?.feeAmountRaw ?? "0";
    try {
      return BigInt(String(raw));
    } catch {
      return 0n;
    }
  }, [quote]);

  const { totalGrossRaw, totalNetRaw, totalWithFeeRaw, amountModeError } = useMemo(() => {
    const totalGross = parsed.totalNet;
    let totalNet = totalGross;
    let totalWithFee = totalGross + feeAmountRaw;
    let modeError = "";

    if (amountMode === "net") {
      totalWithFee = totalGross;
      if (feeAmountRaw > 0n) {
        if (totalGross <= feeAmountRaw) {
          modeError = "Total amount must be greater than fee for net mode.";
        } else if (parsed.entries.length) {
          const lastIdx = parsed.entries.length - 1;
          const lastRaw = BigInt(parsed.entries[lastIdx].amountRaw);
          if (lastRaw <= feeAmountRaw) {
            modeError = "Last recipient amount must exceed fee for net mode.";
          } else {
            totalNet = totalGross - feeAmountRaw;
          }
        }
      }
    } else {
      totalNet = totalGross;
      totalWithFee = totalGross + feeAmountRaw;
    }

    return {
      totalGrossRaw: totalGross,
      totalNetRaw: totalNet,
      totalWithFeeRaw: totalWithFee,
      amountModeError: modeError,
    };
  }, [amountMode, feeAmountRaw, parsed.entries, parsed.totalNet]);

  const totalNetDisplayAdjusted = useMemo(() => {
    if (totalNetRaw <= 0n) return "0";
    return ethers.formatUnits(totalNetRaw, DECIMALS);
  }, [totalNetRaw]);

  const totalWithFeeDisplay = useMemo(() => {
    if (totalWithFeeRaw <= 0n) return "0";
    return ethers.formatUnits(totalWithFeeRaw, DECIMALS);
  }, [totalWithFeeRaw]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!address || !publicClient || !usdcAddress || !quote) {
        setBalanceError("");
        return;
      }
      if (!parsed.entries.length || parsed.errors.length) {
        setBalanceError("");
        return;
      }
      if (amountModeError) {
        setBalanceError(amountModeError);
        return;
      }
      try {
        const balance = await publicClient.readContract({
          address: usdcAddress as `0x${string}`,
          abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] }],
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        });
        if (cancelled) return;
        const required = amountMode === "net" ? totalGrossRaw : totalWithFeeRaw;
        if (balance < required) {
          const need = ethers.formatUnits(required, DECIMALS);
          const have = ethers.formatUnits(balance, DECIMALS);
          setBalanceError(`Insufficient balance. Need ${need} USDC, have ${have} USDC.`);
        } else {
          setBalanceError("");
        }
      } catch {
        if (!cancelled) setBalanceError("Failed to check balance.");
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [address, amountMode, amountModeError, parsed.entries.length, parsed.errors.length, publicClient, quote, totalGrossRaw, totalWithFeeRaw, usdcAddress]);

  const fetchQuote = async () => {
    if (!address) {
      setQuoteError("Connect wallet first.");
      return;
    }
    if (!parsed.entries.length || parsed.errors.length) {
      setQuoteError("Fix recipient list errors first.");
      return;
    }
    const to = parsed.entries[0].address;
    const amountRaw = parsed.totalNet.toString();
    setQuoteLoading(true);
    setQuoteError("");
    setQuote(null);
    try {
      const res = await fetch(qpUrl("/quoteBulk"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: 84532,
          from: address,
          token: usdcAddress,
          to,
          amount: amountRaw,
          feeMode: speedLabel,
          speed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503 && data?.code === "BULK_NOT_CONFIGURED") {
        setBulkNotConfigured(true);
        throw new Error("Bulk is not enabled on the API yet. Set ROUTER_BULK/PAYMASTER_BULK in Railway.");
      }
      if (res.status === 400 || data?.ok === false) {
        const details = data?.details ? ` ${JSON.stringify(data.details)}` : "";
        throw new Error(`${data?.error || "Bad request"}${details}`.trim());
      }
      if (!res.ok) throw new Error(data?.error || "Failed to get quote");
      setQuote(data);
      void logAppEvent("bulk_quote_success", {
        address,
        meta: {
          recipients: parsed.entries.length,
          totalNet: parsed.totalNet.toString(),
          speed,
        },
      });
    } catch (err: any) {
      setQuoteError(err?.message || "Failed to get quote");
      void logAppEvent("bulk_quote_error", {
        address,
        meta: {
          recipients: parsed.entries.length,
          totalNet: parsed.totalNet.toString(),
          speed,
          message: String(err?.message || "bulk_quote_failed"),
        },
      });
    } finally {
      setQuoteLoading(false);
    }
  };

  const sendBulk = async () => {
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    if (!parsed.entries.length || parsed.errors.length) {
      setError("Fix recipient list errors first.");
      return;
    }
    if (amountModeError) {
      setError(amountModeError);
      return;
    }
    if (balanceError) {
      setError(balanceError);
      return;
    }
    if (!quote) {
      setError("Get a quote first.");
      return;
    }

    setLoading(true);
    setError("");
    setStatus("");
    setResult(null);
    setBulkNotConfigured(false);

    try {
      const chainId = 84532;
      const routerAddr = String(
        import.meta.env.VITE_ROUTER_BULK ?? quote?.router ?? getQuickPayChainConfig(chainId)?.router ?? ""
      ).trim();
      if (!ethers.isAddress(routerAddr)) {
        throw new Error("Missing router address for EIP3009");
      }
      if (!publicClient) {
        throw new Error("Wallet client unavailable");
      }

      let tokenName = "USD Coin";
      let tokenVersion = "2";
      const eip3009Abi = [
        { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
        { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
      ] as const;
      try {
        tokenName = await publicClient.readContract({
          address: usdcAddress as `0x${string}`,
          abi: eip3009Abi,
          functionName: "name",
        });
      } catch {}
      try {
        tokenVersion = await publicClient.readContract({
          address: usdcAddress as `0x${string}`,
          abi: eip3009Abi,
          functionName: "version",
        });
      } catch {}

      const feeAmountRaw = BigInt(String(quote?.feeTokenAmount || "0"));
      if (feeAmountRaw <= 0n) {
        throw new Error("Invalid fee from quote");
      }
      const totalWithFee = totalWithFeeRaw;

      const now = Math.floor(Date.now() / 1000);
      const validAfter = now - 10;
      const validBefore = now + 60 * 60;
      const nonce = ethers.hexlify(ethers.randomBytes(32));

      const typedData = {
        domain: {
          name: tokenName,
          version: tokenVersion,
          chainId,
          verifyingContract: usdcAddress as `0x${string}`,
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
          from: address.toLowerCase() as `0x${string}`,
          to: routerAddr as `0x${string}`,
          value: totalWithFee,
          validAfter: BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce: nonce as `0x${string}`,
        },
      } as const;

      setStatus("Waiting for EIP-3009 signature…");
      const signature = await signTypedDataAsync(typedData);
      const auth = {
        type: "EIP3009",
        from: typedData.message.from,
        to: typedData.message.to,
        value: typedData.message.value.toString(),
        validAfter: typedData.message.validAfter.toString(),
        validBefore: typedData.message.validBefore.toString(),
        nonce: typedData.message.nonce,
        signature,
      };

      const sendPayload: any = {
        chainId,
        from: address,
        token: usdcAddress,
        transfers: parsed.entries.map((entry) => ({ to: entry.address, amount: entry.amountRaw })),
        speed,
        amountMode,
        auth,
      };
      if (referenceId.trim()) sendPayload.referenceId = referenceId.trim();
      if (name.trim()) sendPayload.name = name.trim();
      if (message.trim()) sendPayload.message = message.trim();
      if (reason.trim()) sendPayload.reason = reason.trim();
      if (note.trim()) sendPayload.note = note.trim();

      const postSend = async (payload: any) => {
        const res = await fetch(qpUrl("/sendBulk"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 503 && data?.code === "BULK_NOT_CONFIGURED") {
          setBulkNotConfigured(true);
          throw new Error("Bulk is not enabled on the API yet. Set ROUTER_BULK/PAYMASTER_BULK in Railway.");
        }
        if (!res.ok) {
          throw new Error(data?.error || "Bulk send failed");
        }
        return data;
      };

      setStatus("Submitting sponsored bulk userOp…");
      let data = await postSend(sendPayload);
      const needsUserOpSig = data?.needsUserOpSignature === true && /^0x[0-9a-fA-F]{64}$/.test(String(data?.userOpHash || ""));
      if (needsUserOpSig && !sendPayload.userOpSignature) {
        setStatus("Waiting for userOp signature…");
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();
        const sig = await signer.signMessage(ethers.getBytes(data.userOpHash));
        if (!data?.userOpDraft) {
          throw new Error("Missing userOpDraft from server response.");
        }
        setStatus("Submitting signed userOp…");
        data = await postSend({ ...sendPayload, userOpSignature: sig, userOpDraft: data.userOpDraft });
      }

      setResult(data);
      setStatus("Done");

      void logAppEvent("bulk_send_success", {
        address,
        meta: {
          receiptId: data?.receiptId || data?.receipt_id || null,
          userOpHash: data?.userOpHash || null,
          recipients: parsed.entries.length,
          totalNet: parsed.totalNet.toString(),
          speed,
        },
      });

      const receiptId = data?.receiptId || data?.receipt_id || "";
      if (receiptId && note.trim()) {
        try {
          const provider = new ethers.BrowserProvider((window as any).ethereum);
          const signer = await provider.getSigner();
          const senderLower = address.toLowerCase();
          const noteMessage = `Dendrites QuickPay Note v1\nAction: SET\nReceipt: ${receiptId}\nSender: ${senderLower}\nChainId: ${chainId}`;
          const signature = await signer.signMessage(noteMessage);
          await quickpayNoteSet({ receiptId, sender: senderLower, note: note.trim(), signature, chainId });
        } catch (err) {
          console.warn("NOTE_SAVE_FAILED", err);
        }
      }
      if (receiptId) {
        navigate(`/r/${receiptId}`);
      }
    } catch (err: any) {
      setError(err?.message || "Bulk send failed");
      void logAppEvent("bulk_send_error", {
        address,
        meta: {
          recipients: parsed.entries.length,
          totalNet: parsed.totalNet.toString(),
          speed,
          message: String(err?.message || "bulk_send_failed"),
        },
      });
    } finally {
      setLoading(false);
    }
  };

return (
  <main className="dx-container">
    <header>
      <div className="dx-kicker">DENDRITES</div>
      <h1 className="dx-h1">Bulk Pay</h1>
      <p className="dx-sub">
        USDC bulk payouts (Beta). Paste recipients as one per line: <span className="dx-muted">address amount</span>.
      </p>
    </header>

    {bulkNotConfigured ? (
      <div className="dx-alert dx-alert-warn" style={{ marginTop: 12 }}>
        Bulk is not enabled on the API yet. Set ROUTER_BULK/PAYMASTER_BULK in Railway.
      </div>
    ) : null}

<div className="dx-bulkGrid" style={{ marginTop: 14 }}>
      {/* LEFT: FORM */}
      <section className="dx-card">
        <div className="dx-card-in">
          <div className="dx-card-head">
            <h2 className="dx-card-title">Recipients</h2>
            <p className="dx-card-hint">{speedLabel.toUpperCase()} • USDC</p>
          </div>

          <div className="dx-form">
            <div className="dx-field">
              <span className="dx-label">Recipients (address, amount)</span>
              <textarea
                rows={9}
                value={recipientsInput}
                onChange={(e) => setRecipientsInput(e.target.value)}
                placeholder={`0xabc... 12.34\n0xdef... 5.00`}
                style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
              />
              <div className="dx-help">
                Accepted separators: space or comma. Example: <span className="dx-muted">0xabc… 12.34</span>
              </div>
            </div>

            <div className="dx-row2">
              <div className="dx-field">
                <span className="dx-label">Reference ID (optional, 32-byte hex)</span>
                <input value={referenceId} onChange={(e) => setReferenceId(e.target.value)} placeholder="0x..." />
              </div>

              <div className="dx-field">
                <span className="dx-label">Speed</span>
                <select value={speed} onChange={(e) => setSpeed(Number(e.target.value) as 0 | 1)}>
                  <option value={0}>eco</option>
                  <option value={1}>instant</option>
                </select>
              </div>
            </div>

            <div className="dx-field">
              <span className="dx-label">Fee handling</span>
              <select value={amountMode} onChange={(e) => setAmountMode(e.target.value as "net" | "plusFee")}>
                <option value="net">Deduct fee from total (net)</option>
                <option value="plusFee">Add fee on top (plus fee)</option>
              </select>
              {amountModeError ? <div className="dx-alert dx-alert-danger">{amountModeError}</div> : null}
            </div>

            <div className="dx-section" style={{ marginTop: 12 }}>
              <div className="dx-card-head" style={{ marginBottom: 8 }}>
                <h3 className="dx-card-title">Metadata</h3>
                <p className="dx-card-hint">Optional</p>
              </div>

              <div className="dx-row2">
                <div className="dx-field">
                  <span className="dx-label">Name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Paying out" />
                </div>
                <div className="dx-field">
                  <span className="dx-label">Reason</span>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Invoice #123" />
                </div>
              </div>

              <div className="dx-field">
                <span className="dx-label">Message</span>
                <textarea
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Thanks for your help…"
                />
              </div>

              <div className="dx-field">
                <span className="dx-label">Private note</span>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Visible only to you"
                />
              </div>
            </div>

            {/* Errors / Status */}
            {parsed.errors.length ? (
              <div className="dx-alert dx-alert-danger">
                {parsed.errors.map((msg, idx) => (
                  <div key={`${msg}-${idx}`}>{msg}</div>
                ))}
              </div>
            ) : null}

            {balanceError ? <div className="dx-alert dx-alert-danger">{balanceError}</div> : null}
            {quoteError ? <div className="dx-alert dx-alert-danger">{quoteError}</div> : null}
            {error ? <div className="dx-alert dx-alert-danger">{error}</div> : null}
            {status ? <div className="dx-alert">{status}</div> : null}

            <div className="dx-actions" style={{ marginTop: 12 }}>
              <button className="dx-primary" onClick={fetchQuote} disabled={!isConnected || quoteLoading || loading}>
                {quoteLoading ? "Quoting…" : "Get Quote"}
              </button>
              <button onClick={sendBulk} disabled={!isConnected || loading}>
                {loading ? "Sending…" : "Send Bulk"}
              </button>
            </div>

            {!isConnected ? <div className="dx-alert">Connect wallet to quote & send.</div> : null}
          </div>
        </div>
      </section>

      {/* RIGHT: SUMMARY + RESULT */}
<aside className="dx-stack dx-bulkSummary">
        <section className="dx-card">
          <div className="dx-card-in">
            <div className="dx-card-head">
              <h2 className="dx-card-title">Summary</h2>
              <p className="dx-card-hint">Preview</p>
            </div>

            <div className="dx-section">
              <div className="dx-kv">
                <div className="dx-k">Recipients</div>
                <div className="dx-v">{parsed.entries.length}</div>

                <div className="dx-k">Total input</div>
                <div className="dx-v">{totalNetDisplay} USDC</div>

                <div className="dx-k">Fee</div>
                <div className="dx-v">
                  {quote?.feeTokenAmount
                    ? `${ethers.formatUnits(BigInt(String(quote.feeTokenAmount)), DECIMALS)} USDC`
                    : "—"}
                </div>

                <div className="dx-k">Recipients total</div>
                <div className="dx-v">{totalNetDisplayAdjusted} USDC</div>

                <div className="dx-k">Total charged</div>
                <div className="dx-v">
                  <span className="dx-chip dx-chipBlue">{totalWithFeeDisplay} USDC</span>
                </div>

                <div className="dx-k">Mode</div>
                <div className="dx-v">{amountMode}</div>
              </div>
            </div>

            {amountModeError ? (
              <div className="dx-alert dx-alert-danger" style={{ marginTop: 10 }}>
                {amountModeError}
              </div>
            ) : null}
            {balanceError ? (
              <div className="dx-alert dx-alert-danger" style={{ marginTop: 10 }}>
                {balanceError}
              </div>
            ) : null}
          </div>
        </section>

        <section className="dx-card">
          <div className="dx-card-in">
            <div className="dx-card-head">
              <h2 className="dx-card-title">Result</h2>
              <p className="dx-card-hint">{result ? "Completed" : "—"}</p>
            </div>

            {!result ? (
              <div className="dx-muted">
                No result yet. Get a quote, then send bulk to generate a receipt.
              </div>
            ) : (
              <div className="dx-section">
                <div className="dx-kv">
                  <div className="dx-k">Request ID</div>
                  <div className="dx-v">{result.reqId || "-"}</div>

                  <div className="dx-k">Receipt</div>
                  <div className="dx-v">
                    {result.receiptId ? (
                      <a className="dx-linkBtn" href={`/receipts/${result.receiptId}`} target="_blank" rel="noreferrer">
                        {result.receiptId}
                      </a>
                    ) : (
                      "-"
                    )}
                  </div>

                  <div className="dx-k">UserOp Hash</div>
                  <div className="dx-v">
                    {result.userOpHash ? (
                      <a
                        className="dx-linkBtn"
                        href={`https://sepolia.basescan.org/tx/${result.userOpHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {result.userOpHash}
                      </a>
                    ) : (
                      "-"
                    )}
                  </div>

                  <div className="dx-k">Tx Hash</div>
                  <div className="dx-v">
                    {result.txHash ? (
                      <a
                        className="dx-linkBtn"
                        href={`https://sepolia.basescan.org/tx/${result.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {result.txHash}
                      </a>
                    ) : (
                      "-"
                    )}
                  </div>

                  <div className="dx-k">Recipients</div>
                  <div className="dx-v">{parsed.entries.length}</div>

                  <div className="dx-k">Mode</div>
                  <div className="dx-v">{result.modeUsed || amountMode}</div>

                  <div className="dx-k">Fee</div>
                  <div className="dx-v">
                    {result.feeAmountRaw ? ethers.formatUnits(BigInt(String(result.feeAmountRaw)), DECIMALS) : "-"} USDC
                  </div>

                  <div className="dx-k">Recipients total</div>
                  <div className="dx-v">
                    {result.netAmountRaw
                      ? ethers.formatUnits(BigInt(String(result.netAmountRaw)), DECIMALS)
                      : "-"}{" "}
                    USDC
                  </div>

                  <div className="dx-k">Total charged</div>
                  <div className="dx-v">
                    {result.totalAmountRaw
                      ? ethers.formatUnits(BigInt(String(result.totalAmountRaw)), DECIMALS)
                      : "-"}{" "}
                    USDC
                  </div>

                  <div className="dx-k">Reference ID</div>
                  <div className="dx-v">{result.referenceId || referenceId || "-"}</div>
                </div>
              </div>
            )}
          </div>
        </section>
      </aside>
    </div>
  </main>
);

}
