import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import MainnetConfirmModal from "../components/MainnetConfirmModal";
import { buildEip1559Fees, estimateTxCost } from "../lib/txEstimate";
import { normalizeWalletError } from "../lib/walletErrors";

export default function NonceRescue() {
  const { address, isConnected, chainId } = useAccount();
  const [nonceLatest, setNonceLatest] = useState<number | null>(null);
  const [noncePending, setNoncePending] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState("");
  const [txInfo, setTxInfo] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [txGuardMessage, setTxGuardMessage] = useState("");
  const [cancelNonce, setCancelNonce] = useState("");
  const [cancelStatus, setCancelStatus] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [cancelErrorDetails, setCancelErrorDetails] = useState<string | null>(null);
  const [cancelTxHash, setCancelTxHash] = useState("");
  const [speedNonce, setSpeedNonce] = useState("");
  const [speedTo, setSpeedTo] = useState("");
  const [speedValue, setSpeedValue] = useState("0");
  const [speedData, setSpeedData] = useState("0x");
  const [speedMaxFee, setSpeedMaxFee] = useState("");
  const [speedMaxPriorityFee, setSpeedMaxPriorityFee] = useState("");
  const [speedStatus, setSpeedStatus] = useState("");
  const [speedError, setSpeedError] = useState("");
  const [speedErrorDetails, setSpeedErrorDetails] = useState<string | null>(null);
  const [speedTxHash, setSpeedTxHash] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmSummary, setConfirmSummary] = useState("");
  const [confirmGasEstimate, setConfirmGasEstimate] = useState<string | null>(null);
  const [confirmGasError, setConfirmGasError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<null | (() => Promise<void>)>(null);

  const formatReplacementError = (err: any) => {
    const normalized = normalizeWalletError(err);
    const text = `${normalized.message} ${normalized.details ?? ""}`.toLowerCase();
    if (text.includes("nonce too low")) {
      return {
        message: "Tx already confirmed; cannot replace. Use a pending tx hash.",
        details: normalized.details,
      };
    }
    if (text.includes("replacement transaction underpriced") || text.includes("fee too low") || text.includes("replacement fee")) {
      return {
        message: "Fee bump too small; try x1.5 or x2.",
        details: normalized.details,
      };
    }
    if (text.includes("insufficient funds")) {
      const match = text.match(/have\s+(\d+)\s+want\s+(\d+)/i);
      if (match?.[1] && match?.[2]) {
        try {
          const have = ethers.formatEther(BigInt(match[1]));
          const want = ethers.formatEther(BigInt(match[2]));
          return {
            message: `Insufficient funds: have ${have} ETH, need ${want} ETH.`,
            details: normalized.details,
          };
        } catch {
          return { message: normalized.message, details: normalized.details };
        }
      }
    }
    return { message: normalized.message, details: normalized.details };
  };

  const loadNonces = useCallback(async () => {
    setError("");
    if (!address || !isConnected) {
      setNonceLatest(null);
      setNoncePending(null);
      return;
    }
    const ethereum = (window as any)?.ethereum;
    if (!ethereum) {
      setError("Wallet provider not available.");
      return;
    }
    setLoading(true);
    try {
      const provider = new ethers.BrowserProvider(ethereum);
      const latest = await provider.getTransactionCount(address, "latest");
      const pending = await provider.getTransactionCount(address, "pending");
      setNonceLatest(Number(latest));
      setNoncePending(Number(pending));
    } catch (err: any) {
      setError(err?.message || "Failed to fetch nonces.");
    } finally {
      setLoading(false);
    }
  }, [address, isConnected]);

  useEffect(() => {
    loadNonces();
  }, [loadNonces]);

  const withMainnetConfirm = async (
    summary: string,
    txRequest: ethers.TransactionRequest,
    setStatus: (value: string) => void,
    action: () => Promise<void>
  ) => {
    const provider = new ethers.BrowserProvider((window as any).ethereum);
    const estimate = await estimateTxCost(provider, txRequest);
    if (chainId === 8453) {
      setConfirmSummary(summary);
      setConfirmGasEstimate(estimate.costEth);
      setConfirmGasError(estimate.error);
      setConfirmAction(() => action);
      setConfirmOpen(true);
      return;
    }
    if (estimate.costEth) {
      setStatus(`Estimated gas: ${estimate.costEth}`);
    } else if (estimate.error) {
      setStatus("Unable to estimate; wallet will show final gas.");
    }
    await action();
  };

  const hasPending = nonceLatest != null && noncePending != null && noncePending > nonceLatest;
  const hasTxInfo = Boolean(txInfo);
  const chainWarning = chainId && chainId !== 84532;

return (
  <div className="dx-container">
    <div className="dx-kicker">Utilities</div>
    <div className="dx-card-head" style={{ marginBottom: 0 }}>
      <div>
        <h1 className="dx-h1">Nonce Rescue</h1>
        <div className="dx-sub">
          Fix stuck / pending transactions by replacing the same nonce with higher fees.
        </div>
      </div>

      <div className="dx-actions" style={{ marginTop: 0 }}>
        <Link className="dx-linkBtn" to="/quickpay">
          ← Back to QuickPay
        </Link>
        <button className="dx-miniBtn" onClick={loadNonces} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
    </div>

    {chainWarning ? (
      <div className="dx-alert dx-alert-warn" style={{ marginTop: 14 }}>
        Warning: connected to chain {chainId}. This tool targets Base Sepolia (84532).
      </div>
    ) : null}

    <div className="dx-stack" style={{ marginTop: 14 }}>
      <details className="dx-card">
        <summary className="dx-card-in">
          <div className="dx-card-head" style={{ marginBottom: 0 }}>
            <div>
              <div className="dx-card-title">How it works</div>
              <div className="dx-card-hint">
                Replace = same nonce + higher fee → pending tx gets replaced.
              </div>
            </div>
          </div>
        </summary>
        <div className="dx-card-in" style={{ paddingTop: 0 }}>
          <ul className="dx-steps">
            <li>Nonce basics: “latest” is mined count; “pending” includes unconfirmed txs.</li>
            <li>Replace rule: same nonce + higher fee replaces the pending tx.</li>
          </ul>
        </div>
      </details>

      <div className="dx-grid">
        {/* LEFT: Actions */}
        <div className="dx-stack">
          {/* Fetch by tx hash */}
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-head">
                <div>
                  <div className="dx-card-title">Fetch by tx hash</div>
                  <div className="dx-card-hint">
                    Pull nonce / to / value / data and draft a Speed Up replacement.
                  </div>
                </div>
              </div>

              <div className="dx-form">
                <div className="dx-field">
                  <div className="dx-label">Transaction hash</div>
                  <div className="dx-codeRow">
                    <input
                      placeholder="0x… tx hash"
                      value={txHash}
                      onChange={(e) => setTxHash(e.target.value)}
                    />
                    <button
                      className="dx-miniBtn"
                      onClick={async () => {
                        setTxError("");
                        setTxInfo(null);
                        setDraft(null);
                        setTxGuardMessage("");
                        if (!txHash.trim()) {
                          setTxError("Enter a tx hash.");
                          return;
                        }
                        const ethereum = (window as any)?.ethereum;
                        if (!ethereum) {
                          setTxError("Wallet provider not available.");
                          return;
                        }
                        setTxLoading(true);
                        try {
                          const provider = new ethers.BrowserProvider(ethereum);
                          const tx = await provider.getTransaction(txHash.trim());
                          if (!tx) {
                            setTxError(
                              "Could not fetch this tx from RPC. If the tx is only in your wallet UI, copy the nonce and fill the manual form."
                            );
                            return;
                          }
                          const receipt = await provider.getTransactionReceipt(txHash.trim());
                          let latestNonce = nonceLatest;
                          if (latestNonce == null && address) {
                            try {
                              latestNonce = Number(await provider.getTransactionCount(address, "latest"));
                            } catch {
                              latestNonce = null;
                            }
                          }
                          if (receipt?.blockNumber || (latestNonce != null && Number(tx.nonce) < latestNonce)) {
                            setTxGuardMessage("Tx already confirmed; cannot replace. Use a pending tx hash.");
                          }
                          setTxInfo(tx);
                        } catch (err: any) {
                          setTxError(err?.message || "Failed to fetch tx.");
                        } finally {
                          setTxLoading(false);
                        }
                      }}
                      disabled={txLoading}
                    >
                      {txLoading ? "Fetching…" : "Fetch"}
                    </button>
                  </div>
                  {txError ? <div className="dx-danger">{txError}</div> : null}
                </div>

                {hasTxInfo ? (
                  <div className="dx-section">
                    <div className="dx-card-title" style={{ marginBottom: 10 }}>Transaction details</div>

                    <div className="dx-kv">
                      <div className="dx-k">Nonce</div>
                      <div className="dx-v dx-mono">{txInfo.nonce}</div>

                      <div className="dx-k">To</div>
                      <div className="dx-v dx-mono">{txInfo.to ?? "—"}</div>

                      <div className="dx-k">Value (wei)</div>
                      <div className="dx-v dx-mono">{txInfo.value?.toString?.() ?? "0"}</div>

                      <div className="dx-k">Fees</div>
                      <div className="dx-v dx-mono">
                        {txInfo.maxFeePerGas
                          ? `maxFeePerGas=${txInfo.maxFeePerGas.toString()} maxPriorityFeePerGas=${txInfo.maxPriorityFeePerGas?.toString?.() || "0"}`
                          : `gasPrice=${txInfo.gasPrice?.toString?.() || "0"}`}
                      </div>

                      <div className="dx-k">Chain ID</div>
                      <div className="dx-v dx-mono">{txInfo.chainId?.toString?.() ?? "—"}</div>

                      <div className="dx-k">Data</div>
                      <div className="dx-v">
                        <div className="dx-codeBox">
                          {String(txInfo.data ?? "").length > 420
                            ? `${String(txInfo.data).slice(0, 420)}…`
                            : String(txInfo.data ?? "")}
                        </div>
                      </div>
                    </div>

                    <div className="dx-btnRow">
                      <button
                        className="dx-linkBtn"
                        onClick={() => {
                          const type = txInfo.maxFeePerGas ? "eip1559" : "legacy";
                          setDraft({
                            nonce: txInfo.nonce,
                            to: txInfo.to ?? "",
                            value: txInfo.value?.toString?.() ?? "0",
                            data: txInfo.data ?? "0x",
                            type,
                            maxFeePerGas: txInfo.maxFeePerGas?.toString?.() ?? null,
                            maxPriorityFeePerGas: txInfo.maxPriorityFeePerGas?.toString?.() ?? null,
                            gasPrice: txInfo.gasPrice?.toString?.() ?? null,
                          });
                          setSpeedNonce(String(txInfo.nonce ?? ""));
                          setSpeedTo(String(txInfo.to ?? ""));
                          setSpeedValue(String(txInfo.value?.toString?.() ?? "0"));
                          setSpeedData(String(txInfo.data ?? "0x"));
                        }}
                        disabled={Boolean(txGuardMessage)}
                      >
                        Use for Speed Up
                      </button>
                    </div>

                    {txGuardMessage ? (
                      <div className="dx-alert dx-alert-warn" style={{ marginTop: 10 }}>
                        {txGuardMessage}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {draft ? (
                  <div className="dx-alert" style={{ marginTop: 2 }}>
                    <div className="dx-card-title" style={{ marginBottom: 8 }}>Speed Up Draft</div>
                    <div className="dx-kv">
                      <div className="dx-k">Nonce</div>
                      <div className="dx-v dx-mono">{draft.nonce}</div>
                      <div className="dx-k">To</div>
                      <div className="dx-v dx-mono">{draft.to || "—"}</div>
                      <div className="dx-k">Value (wei)</div>
                      <div className="dx-v dx-mono">{draft.value}</div>
                      <div className="dx-k">Type</div>
                      <div className="dx-v dx-mono">{draft.type}</div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Cancel */}
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-head">
                <div>
                  <div className="dx-card-title">Cancel transaction</div>
                  <div className="dx-card-hint">
                    Replacement must use the same nonce and higher fees. Sends 0 ETH to yourself.
                  </div>
                </div>
              </div>

              <div className="dx-form">
                <div className="dx-field">
                  <div className="dx-label">Nonce</div>
                  <div className="dx-codeRow">
                    <input
                      placeholder="nonce"
                      value={cancelNonce}
                      onChange={(e) => setCancelNonce(e.target.value)}
                    />
                    <button
                      className="dx-miniBtn"
                      onClick={async () => {
                        setCancelError("");
                        setCancelErrorDetails(null);
                        setCancelStatus("");
                        setCancelTxHash("");
                        if (!isConnected || !address) {
                          setCancelError("Connect your wallet first.");
                          return;
                        }
                        if (!/^[0-9]+$/.test(cancelNonce)) {
                          setCancelError("Nonce is required.");
                          return;
                        }
                        if (nonceLatest != null && Number(cancelNonce) < nonceLatest) {
                          setCancelError("Tx already confirmed; cannot replace. Use a pending tx hash.");
                          return;
                        }
                        const ethereum = (window as any)?.ethereum;
                        if (!ethereum) {
                          setCancelError("Wallet provider not available.");
                          return;
                        }
                        try {
                          const provider = new ethers.BrowserProvider(ethereum);
                          const fees = await buildEip1559Fees(provider, 1.2);
                          const txRequest: ethers.TransactionRequest = {
                            to: address,
                            from: address,
                            value: 0n,
                            data: "0x",
                            nonce: Number(cancelNonce),
                            gasLimit: 21000n,
                            ...(fees.mode === "eip1559"
                              ? { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }
                              : { gasPrice: fees.gasPrice }),
                          };
                          const summary = `Cancel nonce ${cancelNonce}`;
                          await withMainnetConfirm(summary, txRequest, setCancelStatus, async () => {
                            setCancelStatus("Preparing replacement…");
                            try {
                              const signer = await provider.getSigner();
                              const tx = await signer.sendTransaction(txRequest);
                              setCancelTxHash(tx.hash);
                              setCancelStatus("Replacement submitted.");
                            } catch (err: any) {
                              const formatted = formatReplacementError(err);
                              setCancelError(formatted.message);
                              setCancelErrorDetails(formatted.details ?? null);
                            }
                          });
                        } catch (err: any) {
                          const formatted = formatReplacementError(err);
                          setCancelError(formatted.message);
                          setCancelErrorDetails(formatted.details ?? null);
                        }
                      }}
                    >
                      Cancel nonce
                    </button>
                  </div>
                </div>

                {cancelStatus ? <div className="dx-muted">{cancelStatus}</div> : null}

                {cancelTxHash ? (
                  <div className="dx-miniRow">
                    <span className="dx-pill dx-pillBlue">Tx</span>
                    <span className="dx-mono dx-muted">{cancelTxHash}</span>
                  </div>
                ) : null}

                {cancelError ? (
                  <div className="dx-alert dx-alert-danger">
                    {cancelError}
                    {cancelErrorDetails ? (
                      <details style={{ marginTop: 10 }}>
                        <summary className="dx-muted">Technical details</summary>
                        <div className="dx-codeBox" style={{ marginTop: 8 }}>
                          {cancelErrorDetails}
                        </div>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Speed Up */}
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-head">
                <div>
                  <div className="dx-card-title">Speed up transaction</div>
                  <div className="dx-card-hint">
                    Replacement must use the same nonce and higher fees. You pay network gas.
                  </div>
                </div>
              </div>

              <div className="dx-form">
                <div className="dx-field">
                  <div className="dx-label">Nonce</div>
                  <input
                    placeholder="nonce"
                    value={speedNonce}
                    onChange={(e) => setSpeedNonce(e.target.value)}
                  />
                </div>

                <div className="dx-field">
                  <div className="dx-label">To</div>
                  <input
                    placeholder="to"
                    value={speedTo}
                    onChange={(e) => setSpeedTo(e.target.value)}
                  />
                </div>

                <div className="dx-field">
                  <div className="dx-label">Value (wei)</div>
                  <input
                    placeholder="value (wei)"
                    value={speedValue}
                    onChange={(e) => setSpeedValue(e.target.value)}
                  />
                </div>

                <div className="dx-field">
                  <div className="dx-label">Data</div>
                  <input
                    placeholder="data (0x...)"
                    value={speedData}
                    onChange={(e) => setSpeedData(e.target.value)}
                  />
                </div>

                <div className="dx-field">
                  <div className="dx-label">Fees (optional)</div>
                  <div className="dx-codeRow">
                    <input
                      placeholder="maxFeePerGas (wei)"
                      value={speedMaxFee}
                      onChange={(e) => setSpeedMaxFee(e.target.value)}
                    />
                    <input
                      placeholder="maxPriorityFeePerGas (wei)"
                      value={speedMaxPriorityFee}
                      onChange={(e) => setSpeedMaxPriorityFee(e.target.value)}
                    />
                    <button
                      className="dx-miniBtn"
                      onClick={async () => {
                        setSpeedError("");
                        const ethereum = (window as any)?.ethereum;
                        if (!ethereum) {
                          setSpeedError("Wallet provider not available.");
                          return;
                        }
                        try {
                          const provider = new ethers.BrowserProvider(ethereum);
                          const fees = await buildEip1559Fees(provider, 1.2, {
                            maxFeePerGas: draft?.maxFeePerGas ? BigInt(draft.maxFeePerGas) : null,
                            maxPriorityFeePerGas: draft?.maxPriorityFeePerGas ? BigInt(draft.maxPriorityFeePerGas) : null,
                            gasPrice: draft?.gasPrice ? BigInt(draft.gasPrice) : null,
                          });
                          if (fees.mode === "eip1559") {
                            setSpeedMaxPriorityFee(fees.maxPriorityFeePerGas.toString());
                            setSpeedMaxFee(fees.maxFeePerGas.toString());
                          } else {
                            setSpeedMaxPriorityFee("");
                            setSpeedMaxFee("");
                          }
                        } catch (err: any) {
                          setSpeedError(err?.message || "Failed to load suggested fees.");
                        }
                      }}
                    >
                      Suggested
                    </button>
                  </div>
                  <div className="dx-help">
                    Tip: a small fee bump may fail — try x1.5 or x2 when needed.
                  </div>
                </div>

                <div className="dx-actions">
                  <button
                    className="dx-primary"
                    onClick={async () => {
                      setSpeedError("");
                      setSpeedErrorDetails(null);
                      setSpeedStatus("");
                      setSpeedTxHash("");
                      if (!isConnected || !address) {
                        setSpeedError("Connect your wallet first.");
                        return;
                      }
                      if (!/^[0-9]+$/.test(speedNonce)) {
                        setSpeedError("Nonce is required.");
                        return;
                      }
                      if (nonceLatest != null && Number(speedNonce) < nonceLatest) {
                        setSpeedError("Tx already confirmed; cannot replace. Use a pending tx hash.");
                        return;
                      }
                      if (!speedTo || !ethers.isAddress(speedTo)) {
                        setSpeedError("Valid 'to' address required.");
                        return;
                      }
                      if (!/^[0-9]+$/.test(speedValue)) {
                        setSpeedError("Value must be a wei integer string.");
                        return;
                      }
                      const dataField = speedData.trim() || "0x";
                      if (!dataField.startsWith("0x")) {
                        setSpeedError("Data must be hex starting with 0x.");
                        return;
                      }
                      const ethereum = (window as any)?.ethereum;
                      if (!ethereum) {
                        setSpeedError("Wallet provider not available.");
                        return;
                      }
                      try {
                        const provider = new ethers.BrowserProvider(ethereum);
                        const fees = await buildEip1559Fees(provider, 1.2, {
                          maxFeePerGas: draft?.maxFeePerGas ? BigInt(draft.maxFeePerGas) : null,
                          maxPriorityFeePerGas: draft?.maxPriorityFeePerGas ? BigInt(draft.maxPriorityFeePerGas) : null,
                          gasPrice: draft?.gasPrice ? BigInt(draft.gasPrice) : null,
                        });
                        const txRequest: ethers.TransactionRequest = {
                          to: speedTo,
                          from: address,
                          value: BigInt(speedValue),
                          data: dataField,
                          nonce: Number(speedNonce),
                          ...(fees.mode === "eip1559"
                            ? { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }
                            : { gasPrice: fees.gasPrice }),
                        };
                        const summary = `Speed up nonce ${speedNonce}`;
                        await withMainnetConfirm(summary, txRequest, setSpeedStatus, async () => {
                          setSpeedStatus("Preparing replacement…");
                          try {
                            const signer = await provider.getSigner();
                            const tx = await signer.sendTransaction(txRequest);
                            setSpeedTxHash(tx.hash);
                            setSpeedStatus("Replacement submitted.");
                          } catch (err: any) {
                            const formatted = formatReplacementError(err);
                            setSpeedError(formatted.message);
                            setSpeedErrorDetails(formatted.details ?? null);
                          }
                        });
                      } catch (err: any) {
                        const formatted = formatReplacementError(err);
                        setSpeedError(formatted.message);
                        setSpeedErrorDetails(formatted.details ?? null);
                      }
                    }}
                  >
                    Send Speed Up
                  </button>
                </div>

                {speedStatus ? <div className="dx-muted">{speedStatus}</div> : null}

                {speedTxHash ? (
                  <div className="dx-miniRow">
                    <span className="dx-pill dx-pillBlue">Tx</span>
                    <span className="dx-mono dx-muted">{speedTxHash}</span>
                  </div>
                ) : null}

                {speedError ? (
                  <div className="dx-alert dx-alert-danger">
                    {speedError}
                    {speedErrorDetails ? (
                      <details style={{ marginTop: 10 }}>
                        <summary className="dx-muted">Technical details</summary>
                        <div className="dx-codeBox" style={{ marginTop: 8 }}>
                          {speedErrorDetails}
                        </div>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Status + Guidance */}
        <div className="dx-stack">
          {/* Status */}
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-head">
                <div>
                  <div className="dx-card-title">Wallet status</div>
                  <div className="dx-card-hint">Live nonce snapshots from RPC</div>
                </div>

                <div className="dx-rowInline">
                  <span className={`dx-chip ${isConnected ? "dx-chipBlue" : ""}`}>
                    {isConnected ? "Connected" : "Disconnected"}
                  </span>
                  <span className={`dx-chip ${hasPending ? "dx-chipWarn" : "dx-chipOk"}`}>
                    {hasPending ? "Pending" : "Clear"}
                  </span>
                </div>
              </div>

              <div className="dx-kv">
                <div className="dx-k">Address</div>
                <div className="dx-v dx-mono">{isConnected && address ? address : "Not connected"}</div>

                <div className="dx-k">Chain ID</div>
                <div className="dx-v dx-mono">{chainId ?? "Not available"}</div>

                <div className="dx-k">Nonce (latest)</div>
                <div className="dx-v">
                  <div className="dx-rowInline">
                    <span className="dx-mono">{nonceLatest ?? "—"}</span>
                    {nonceLatest != null ? (
                      <button
                        className="dx-copyBtn"
                        onClick={() => navigator.clipboard?.writeText(String(nonceLatest))}
                      >
                        Copy
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="dx-k">Nonce (pending)</div>
                <div className="dx-v">
                  <div className="dx-rowInline">
                    <span className="dx-mono">{noncePending ?? "—"}</span>
                    {noncePending != null ? (
                      <button
                        className="dx-copyBtn"
                        onClick={() => navigator.clipboard?.writeText(String(noncePending))}
                      >
                        Copy
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="dx-divider" />

              <div className="dx-muted">
                {hasPending
                  ? "Pending is higher than latest — you likely have a stuck tx. Use Cancel or Speed Up with the same nonce and higher fee."
                  : "Pending equals latest — no stuck pending queue detected."}
              </div>

              {hasPending ? (
                <div className="dx-alert dx-alert-warn" style={{ marginTop: 12 }}>
                  You have pending transactions. Your next usable nonce is {noncePending} but nonce{" "}
                  {nonceLatest} may be stuck.
                </div>
              ) : null}

              {error ? (
                <div className="dx-alert dx-alert-danger" style={{ marginTop: 12 }}>
                  {error}
                </div>
              ) : null}
            </div>
          </div>

          {/* What next */}
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-head">
                <div>
                  <div className="dx-card-title">What you can do next</div>
                  <div className="dx-card-hint">Safe checklist before sending</div>
                </div>
              </div>

              <ul className="dx-steps">
                <li>Cancel: send 0 ETH to yourself using the stuck nonce (replacement tx)</li>
                <li>Speed up: resend the same tx with higher fees using the same nonce</li>
                <li>
                  If you don&apos;t know the stuck nonce, check your wallet activity or paste tx hash
                </li>
              </ul>
            </div>
          </div>

          {/* Danger zone */}
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-head">
                <div>
                  <div className="dx-card-title">Danger zone</div>
                  <div className="dx-card-hint">Double-check to/value/data before replacement</div>
                </div>
              </div>

              <div className="dx-alert dx-alert-warn">
                <ul className="dx-steps" style={{ margin: 0 }}>
                  <li>Canceling does not always work if the tx is already mined.</li>
                  <li>Speed up must match intent; be careful with to/value/data.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <MainnetConfirmModal
      open={confirmOpen}
      summary={confirmSummary}
      gasEstimate={confirmGasEstimate}
      gasEstimateError={confirmGasError}
      onCancel={() => {
        setConfirmOpen(false);
        setConfirmAction(null);
        setConfirmSummary("");
        setConfirmGasEstimate(null);
        setConfirmGasError(null);
      }}
      onConfirm={async () => {
        const action = confirmAction;
        setConfirmOpen(false);
        setConfirmAction(null);
        setConfirmSummary("");
        setConfirmGasEstimate(null);
        setConfirmGasError(null);
        if (action) {
          await action();
        }
      }}
    />
  </div>
);

}
