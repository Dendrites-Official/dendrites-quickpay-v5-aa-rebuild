import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import MainnetConfirmModal from "../components/MainnetConfirmModal";
import { estimateTxCost } from "../lib/txEstimate";
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
    <div style={{ padding: 16 }}>
      <h2>Nonce Rescue</h2>
      <div style={{ color: "#bdbdbd", marginTop: 6 }}>
        Fix stuck / pending transactions by replacing the same nonce with higher fees.
      </div>
      <div style={{ marginTop: 10 }}>
        <Link to="/quickpay">Back to QuickPay</Link>
      </div>

      <details style={{ marginTop: 12, maxWidth: 720 }}>
        <summary style={{ cursor: "pointer" }}>How it works</summary>
        <div style={{ marginTop: 8, color: "#d6d6d6" }}>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>Nonce basics: “latest” is mined count; “pending” includes unconfirmed txs.</li>
            <li>Replace rule: same nonce + higher fee replaces the pending tx.</li>
          </ul>
        </div>
      </details>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 520 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Status</div>
        <div><strong>Connected Address:</strong> {isConnected && address ? address : "Not connected"}</div>
        <div><strong>Chain ID:</strong> {chainId ?? "Not available"}</div>
        <div>
          <strong>Nonce (latest):</strong> {nonceLatest ?? "—"}
          {nonceLatest != null ? (
            <button
              style={{ marginLeft: 8 }}
              onClick={() => navigator.clipboard?.writeText(String(nonceLatest))}
            >
              Copy
            </button>
          ) : null}
        </div>
        <div>
          <strong>Nonce (pending):</strong> {noncePending ?? "—"}
          {noncePending != null ? (
            <button
              style={{ marginLeft: 8 }}
              onClick={() => navigator.clipboard?.writeText(String(noncePending))}
            >
              Copy
            </button>
          ) : null}
        </div>
        <div style={{ marginTop: 6, color: "#bdbdbd" }}>
          {hasPending
            ? "Pending is higher than latest — you likely have a stuck tx. Use Cancel or Speed Up with the same nonce and higher fee."
            : "Pending equals latest — no stuck pending queue detected."}
        </div>
        {hasPending ? (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "#3a2f12", color: "#ffd180" }}>
            You have pending transactions. Your next usable nonce is {noncePending} but nonce {nonceLatest} may be stuck.
          </div>
        ) : null}
        {error ? <div style={{ color: "#ff7a7a", marginTop: 8 }}>{error}</div> : null}
      </div>

      <div style={{ marginTop: 12 }}>
        <button onClick={loadNonces} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 720 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Fetch by tx hash</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            style={{ width: "100%", maxWidth: 520, padding: 8 }}
            placeholder="0x… tx hash"
            value={txHash}
            onChange={(e) => setTxHash(e.target.value)}
          />
          <button
            onClick={async () => {
              setTxError("");
              setTxInfo(null);
              setDraft(null);
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
                setTxInfo(tx);
              } catch (err: any) {
                setTxError(err?.message || "Failed to fetch tx.");
              } finally {
                setTxLoading(false);
              }
            }}
            disabled={txLoading}
          >
            {txLoading ? "Fetching..." : "Fetch"}
          </button>
        </div>
        {txError ? <div style={{ color: "#ff7a7a", marginTop: 8 }}>{txError}</div> : null}
        {hasTxInfo ? (
          <div style={{ marginTop: 12, color: "#d6d6d6" }}>
            <div><strong>Nonce:</strong> {txInfo.nonce}</div>
            <div><strong>To:</strong> {txInfo.to ?? "—"}</div>
            <div><strong>Value (wei):</strong> {txInfo.value?.toString?.() ?? "0"}</div>
            <div>
              <strong>Data:</strong>{" "}
              {String(txInfo.data ?? "").length > 66
                ? `${String(txInfo.data).slice(0, 66)}…`
                : String(txInfo.data ?? "")}
            </div>
            <div>
              <strong>Fees:</strong>{" "}
              {txInfo.maxFeePerGas
                ? `maxFeePerGas=${txInfo.maxFeePerGas.toString()} maxPriorityFeePerGas=${txInfo.maxPriorityFeePerGas?.toString?.() || "0"}`
                : `gasPrice=${txInfo.gasPrice?.toString?.() || "0"}`}
            </div>
            <div><strong>Chain ID:</strong> {txInfo.chainId?.toString?.() ?? "—"}</div>
            <div style={{ marginTop: 8 }}>
              <button
                onClick={() => {
                  const type = txInfo.maxFeePerGas ? "eip1559" : "legacy";
                  setDraft({
                    nonce: txInfo.nonce,
                    to: txInfo.to ?? "",
                    value: txInfo.value?.toString?.() ?? "0",
                    data: txInfo.data ?? "0x",
                    type,
                  });
                  setSpeedNonce(String(txInfo.nonce ?? ""));
                  setSpeedTo(String(txInfo.to ?? ""));
                  setSpeedValue(String(txInfo.value?.toString?.() ?? "0"));
                  setSpeedData(String(txInfo.data ?? "0x"));
                }}
              >
                Use for Speed Up
              </button>
            </div>
          </div>
        ) : null}
        {draft ? (
          <div style={{ marginTop: 12, color: "#bdbdbd" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Speed Up Draft</div>
            <div><strong>Nonce:</strong> {draft.nonce}</div>
            <div><strong>To:</strong> {draft.to || "—"}</div>
            <div><strong>Value (wei):</strong> {draft.value}</div>
            <div>
              <strong>Data:</strong>{" "}
              {String(draft.data).length > 66 ? `${String(draft.data).slice(0, 66)}…` : String(draft.data)}
            </div>
            <div><strong>Type:</strong> {draft.type}</div>
          </div>
        ) : null}
      </div>

      {chainWarning ? (
        <div style={{ marginTop: 12, color: "#ffb74d" }}>
          Warning: connected to chain {chainId}. This tool targets Base Sepolia (84532).
        </div>
      ) : null}

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 720 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Cancel Transaction</div>
        <div style={{ color: "#bdbdbd", marginBottom: 8 }}>
          Replacement must use the same nonce and higher fees. This sends 0 ETH to yourself.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            style={{ width: "100%", maxWidth: 200, padding: 8 }}
            placeholder="nonce"
            value={cancelNonce}
            onChange={(e) => setCancelNonce(e.target.value)}
          />
          <button
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
              const ethereum = (window as any)?.ethereum;
              if (!ethereum) {
                setCancelError("Wallet provider not available.");
                return;
              }
              try {
                const provider = new ethers.BrowserProvider(ethereum);
                const feeData = await provider.getFeeData();
                const maxPriority = feeData.maxPriorityFeePerGas
                  ? feeData.maxPriorityFeePerGas * 2n
                  : ethers.parseUnits("2", "gwei");
                const maxFee = feeData.maxFeePerGas
                  ? feeData.maxFeePerGas * 2n
                  : (feeData.gasPrice ? feeData.gasPrice * 2n : ethers.parseUnits("10", "gwei"));
                const txRequest: ethers.TransactionRequest = {
                  to: address,
                  from: address,
                  value: 0n,
                  data: "0x",
                  nonce: Number(cancelNonce),
                  maxPriorityFeePerGas: maxPriority,
                  maxFeePerGas: maxFee,
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
                    const normalized = normalizeWalletError(err);
                    setCancelError(normalized.message);
                    setCancelErrorDetails(normalized.details);
                  }
                });
              } catch (err: any) {
                const normalized = normalizeWalletError(err);
                setCancelError(normalized.message);
                setCancelErrorDetails(normalized.details);
              }
            }}
          >
            Cancel nonce
          </button>
        </div>
        {cancelStatus ? <div style={{ color: "#bdbdbd", marginTop: 8 }}>{cancelStatus}</div> : null}
        {cancelTxHash ? <div style={{ color: "#bdbdbd", marginTop: 6 }}>Tx: {cancelTxHash}</div> : null}
        {cancelError ? (
          <div style={{ color: "#ff7a7a", marginTop: 6 }}>
            {cancelError}
            {cancelErrorDetails ? (
              <details style={{ marginTop: 6, color: "#bdbdbd" }}>
                <summary style={{ cursor: "pointer" }}>Technical details</summary>
                <div style={{ marginTop: 4 }}>{cancelErrorDetails}</div>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 720 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Speed Up Transaction</div>
        <div style={{ color: "#bdbdbd", marginBottom: 8 }}>
          Replacement must use the same nonce and higher fees. You pay network gas.
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              style={{ width: "100%", maxWidth: 200, padding: 8 }}
              placeholder="nonce"
              value={speedNonce}
              onChange={(e) => setSpeedNonce(e.target.value)}
            />
            <input
              style={{ width: "100%", maxWidth: 360, padding: 8 }}
              placeholder="to"
              value={speedTo}
              onChange={(e) => setSpeedTo(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              style={{ width: "100%", maxWidth: 200, padding: 8 }}
              placeholder="value (wei)"
              value={speedValue}
              onChange={(e) => setSpeedValue(e.target.value)}
            />
            <input
              style={{ width: "100%", maxWidth: 520, padding: 8 }}
              placeholder="data (0x...)"
              value={speedData}
              onChange={(e) => setSpeedData(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              style={{ width: "100%", maxWidth: 240, padding: 8 }}
              placeholder="maxFeePerGas (wei)"
              value={speedMaxFee}
              onChange={(e) => setSpeedMaxFee(e.target.value)}
            />
            <input
              style={{ width: "100%", maxWidth: 240, padding: 8 }}
              placeholder="maxPriorityFeePerGas (wei)"
              value={speedMaxPriorityFee}
              onChange={(e) => setSpeedMaxPriorityFee(e.target.value)}
            />
            <button
              onClick={async () => {
                setSpeedError("");
                const ethereum = (window as any)?.ethereum;
                if (!ethereum) {
                  setSpeedError("Wallet provider not available.");
                  return;
                }
                try {
                  const provider = new ethers.BrowserProvider(ethereum);
                  const feeData = await provider.getFeeData();
                  const maxPriority = feeData.maxPriorityFeePerGas
                    ? feeData.maxPriorityFeePerGas * 2n
                    : ethers.parseUnits("2", "gwei");
                  const maxFee = feeData.maxFeePerGas
                    ? feeData.maxFeePerGas * 2n
                    : (feeData.gasPrice ? feeData.gasPrice * 2n : ethers.parseUnits("10", "gwei"));
                  setSpeedMaxPriorityFee(maxPriority.toString());
                  setSpeedMaxFee(maxFee.toString());
                } catch (err: any) {
                  setSpeedError(err?.message || "Failed to load suggested fees.");
                }
              }}
            >
              Suggested
            </button>
          </div>
          <div>
            <button
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
                  const txRequest: ethers.TransactionRequest = {
                    to: speedTo,
                    from: address,
                    value: BigInt(speedValue),
                    data: dataField,
                    nonce: Number(speedNonce),
                    maxFeePerGas: speedMaxFee ? BigInt(speedMaxFee) : undefined,
                    maxPriorityFeePerGas: speedMaxPriorityFee ? BigInt(speedMaxPriorityFee) : undefined,
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
                      const normalized = normalizeWalletError(err);
                      setSpeedError(normalized.message);
                      setSpeedErrorDetails(normalized.details);
                    }
                  });
                } catch (err: any) {
                  const normalized = normalizeWalletError(err);
                  setSpeedError(normalized.message);
                  setSpeedErrorDetails(normalized.details);
                }
              }}
            >
              Send Speed Up
            </button>
          </div>
        </div>
        {speedStatus ? <div style={{ color: "#bdbdbd", marginTop: 8 }}>{speedStatus}</div> : null}
        {speedTxHash ? <div style={{ color: "#bdbdbd", marginTop: 6 }}>Tx: {speedTxHash}</div> : null}
        {speedError ? (
          <div style={{ color: "#ff7a7a", marginTop: 6 }}>
            {speedError}
            {speedErrorDetails ? (
              <details style={{ marginTop: 6, color: "#bdbdbd" }}>
                <summary style={{ cursor: "pointer" }}>Technical details</summary>
                <div style={{ marginTop: 4 }}>{speedErrorDetails}</div>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 16, maxWidth: 520 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>What you can do next</div>
        <ul style={{ margin: 0, paddingLeft: 20, color: "#d6d6d6" }}>
          <li>Cancel: send 0 ETH to yourself using the stuck nonce (replacement tx)</li>
          <li>Speed up: resend the same tx with higher fees using the same nonce</li>
          <li>If you don&apos;t know the stuck nonce, check your wallet activity or paste tx hash (we add this in Part 2)</li>
        </ul>
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px dashed #3a2f12", borderRadius: 8, maxWidth: 720 }}>
        <div style={{ fontWeight: 600, color: "#ffd180", marginBottom: 6 }}>Danger zone</div>
        <ul style={{ margin: 0, paddingLeft: 20, color: "#ffd180" }}>
          <li>Canceling does not always work if the tx is already mined.</li>
          <li>Speed up must match intent; be careful with to/value/data.</li>
        </ul>
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
