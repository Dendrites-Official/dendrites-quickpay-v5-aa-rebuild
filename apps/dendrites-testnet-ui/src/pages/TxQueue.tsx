import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { qpUrl } from "../lib/quickpayApiBase";
import { logEvent } from "../lib/analytics";
import MainnetConfirmModal from "../components/MainnetConfirmModal";
import { estimateTxCost } from "../lib/txEstimate";
import { normalizeWalletError } from "../lib/walletErrors";
import { switchToBase, switchToBaseSepolia } from "../lib/switchChain";

type ActivityItem = {
  hash?: string;
  nonce?: string | number;
  to?: string;
  timeStamp?: string | number;
  isError?: string | number;
  txreceipt_status?: string | number;
};

export default function TxQueue() {
  const { address, isConnected, chainId } = useAccount();
  const [inputAddress, setInputAddress] = useState("");
  const [activeAddress, setActiveAddress] = useState<string | null>(null);
  const [nonceLatest, setNonceLatest] = useState<number | null>(null);
  const [noncePending, setNoncePending] = useState<number | null>(null);
  const [nonceLoading, setNonceLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityRows, setActivityRows] = useState<ActivityItem[]>([]);
  const [explorerBaseUrl, setExplorerBaseUrl] = useState("");
  const [error, setError] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionErrorDetails, setActionErrorDetails] = useState<string | null>(null);
  const [actionTxHash, setActionTxHash] = useState("");
  const [demoStatus, setDemoStatus] = useState("");
  const [demoError, setDemoError] = useState("");
  const [demoTxHash, setDemoTxHash] = useState("");
  const [speedTxHashInput, setSpeedTxHashInput] = useState("");
  const [speedDraft, setSpeedDraft] = useState<any>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmSummary, setConfirmSummary] = useState("");
  const [confirmGasEstimate, setConfirmGasEstimate] = useState<string | null>(null);
  const [confirmGasError, setConfirmGasError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<null | (() => Promise<void>)>(null);
  const [switchStatus, setSwitchStatus] = useState("");

  const providerAvailable = Boolean((window as any)?.ethereum);
  const defaultAddress = isConnected && address ? address : "";

  useEffect(() => {
    if (!inputAddress && defaultAddress) {
      setInputAddress(defaultAddress);
    }
  }, [defaultAddress, inputAddress]);

  const queueRange = useMemo(() => {
    if (nonceLatest == null || noncePending == null || noncePending <= nonceLatest) return null;
    return { start: nonceLatest, end: noncePending - 1 };
  }, [nonceLatest, noncePending]);

  const confirmedNonces = useMemo(() => {
    return activityRows
      .map((item) => Number(item?.nonce ?? NaN))
      .filter((value) => Number.isFinite(value));
  }, [activityRows]);

  const highestConfirmedNonce = useMemo(() => {
    if (!confirmedNonces.length) return null;
    return Math.max(...confirmedNonces);
  }, [confirmedNonces]);

  const queueLength = useMemo(() => {
    if (!queueRange) return 0;
    return Math.max(0, (noncePending ?? 0) - (nonceLatest ?? 0));
  }, [nonceLatest, noncePending, queueRange]);

  const onMainnet = chainId === 8453;
  const onSepolia = chainId === 84532;
  const displayChainLabel = chainId === 8453 ? "Base" : chainId === 84532 ? "Base Sepolia" : chainId ? `Chain ${chainId}` : "Not available";

  const loadNonces = useCallback(
    async (target: string) => {
      setNonceLatest(null);
      setNoncePending(null);
      if (!providerAvailable) {
        throw new Error("Wallet provider not available.");
      }
      setNonceLoading(true);
      try {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const [latest, pending] = await Promise.all([
          provider.getTransactionCount(target, "latest"),
          provider.getTransactionCount(target, "pending"),
        ]);
        setNonceLatest(Number(latest));
        setNoncePending(Number(pending));
      } finally {
        setNonceLoading(false);
      }
    },
    [providerAvailable]
  );

  const loadActivity = useCallback(async (target: string) => {
    setActivityLoading(true);
    setActivityRows([]);
    setExplorerBaseUrl("");
    try {
      if (chainId !== 8453 && chainId !== 84532) {
        throw new Error("Unsupported chain for Activity/TxQueue.");
      }
      const url = qpUrl(
        `/wallet/activity/txlist?address=${target}&chainId=${chainId}&page=1&offset=50&sort=desc`
      );
      const res = await fetch(url);
      if (res.status === 429) {
        throw new Error("Rate limited, retry in a moment.");
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        if (data?.error === "ACTIVITY_NOT_CONFIGURED") {
          throw new Error("Activity feed not configured (explorer API).");
        }
        if (data?.error === "ACTIVITY_UNSUPPORTED_CHAIN") {
          throw new Error("Unsupported chain for Activity/TxQueue.");
        }
        if (data?.error === "RATE_LIMIT") {
          throw new Error("Rate limited, retry in a moment.");
        }
        throw new Error("Failed to load activity.");
      }
      const items = Array.isArray(data?.items) ? data.items : [];
      setExplorerBaseUrl(String(data?.explorerBaseUrl || ""));
      setActivityRows(items);
    } catch (err: any) {
      setError(err?.message || "Failed to load activity.");
    } finally {
      setActivityLoading(false);
    }
  }, [chainId]);

  useEffect(() => {
    if (!activeAddress) return;
    setError("");
    Promise.all([loadNonces(activeAddress), loadActivity(activeAddress)]).catch((err: any) => {
      setError(err?.message || "Failed to refresh tx queue.");
    });
  }, [activeAddress, chainId, loadActivity, loadNonces]);

  useEffect(() => {
    const ethereum = (window as any)?.ethereum;
    if (!ethereum?.on) return;
    const handler = () => {
      if (!activeAddress) return;
      setError("");
      Promise.all([loadNonces(activeAddress), loadActivity(activeAddress)]).catch((err: any) => {
        setError(err?.message || "Failed to refresh tx queue.");
      });
    };
    ethereum.on("chainChanged", handler);
    return () => {
      if (ethereum?.removeListener) {
        ethereum.removeListener("chainChanged", handler);
      }
    };
  }, [activeAddress, loadActivity, loadNonces]);

  const handleLoad = useCallback(async () => {
    setError("");
    setActionStatus("");
    setActionError("");
    setActionErrorDetails(null);
    setActionTxHash("");
    const target = (inputAddress.trim() || defaultAddress).trim();
    if (!target) {
      setError("Enter a wallet address.");
      return;
    }
    if (!ethers.isAddress(target)) {
      setError("Invalid address.");
      return;
    }
    setActiveAddress(target);
    void logEvent("tx_queue_load", { address: target }, address ?? null, chainId ?? null);
    try {
      await Promise.all([loadNonces(target), loadActivity(target)]);
    } catch (err: any) {
      setError(err?.message || "Failed to load tx queue.");
    }
  }, [address, chainId, defaultAddress, inputAddress, loadActivity, loadNonces]);

  const getFeePreset = (multiplier: number, feeData: ethers.FeeData) => {
    const basePriority = feeData.maxPriorityFeePerGas ?? ethers.parseUnits("2", "gwei");
    const baseMax = feeData.maxFeePerGas ?? feeData.gasPrice ?? ethers.parseUnits("10", "gwei");
    return {
      maxPriorityFeePerGas: basePriority * BigInt(Math.round(multiplier * 10)) / 10n,
      maxFeePerGas: baseMax * BigInt(Math.round(multiplier * 10)) / 10n,
    };
  };

  const withMainnetConfirm = async (
    summary: string,
    txRequest: ethers.TransactionRequest,
    action: () => Promise<void>
  ) => {
    const provider = new ethers.BrowserProvider((window as any).ethereum);
    const estimate = await estimateTxCost(provider, txRequest);
    if (onMainnet) {
      setConfirmSummary(summary);
      setConfirmGasEstimate(estimate.costEth);
      setConfirmGasError(estimate.error);
      setConfirmAction(() => action);
      setConfirmOpen(true);
      return;
    }
    if (estimate.costEth) {
      setActionStatus(`Estimated gas: ${estimate.costEth}`);
    } else if (estimate.error) {
      setActionStatus("Unable to estimate; wallet will show final gas.");
    }
    await action();
  };

  const sendCancelReplacement = async (multiplier: number) => {
    setActionError("");
    setActionErrorDetails(null);
    setActionStatus("");
    setActionTxHash("");
    if (!isConnected || !address) {
      setActionError("Connect your wallet first.");
      return;
    }
    if (nonceLatest == null) {
      setActionError("Nonce not available.");
      return;
    }
    if (!providerAvailable) {
      setActionError("Wallet provider not available.");
      return;
    }
    const provider = new ethers.BrowserProvider((window as any).ethereum);
    const feeData = await provider.getFeeData();
    const fees = getFeePreset(multiplier, feeData);
    const txRequest: ethers.TransactionRequest = {
      to: address,
      from: address,
      value: 0n,
      data: "0x",
      nonce: nonceLatest,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };
    const summary = `Cancel nonce ${nonceLatest} (x${multiplier.toFixed(1)})`;
    await withMainnetConfirm(summary, txRequest, async () => {
      setActionStatus("Sending replacement...");
      try {
        const signer = await provider.getSigner();
        const tx = await signer.sendTransaction(txRequest);
        setActionTxHash(tx.hash);
        setActionStatus("Sent replacement.");
        void logEvent(
          "tx_queue_cancel_sent",
          { nonce: nonceLatest, multiplier, txHash: tx.hash },
          address ?? null,
          chainId ?? null
        );
      } catch (err: any) {
        const normalized = normalizeWalletError(err);
        setActionError(normalized.message);
        setActionErrorDetails(normalized.details);
      }
    });
  };

  const fetchSpeedDraft = async () => {
    setActionError("");
    setSpeedDraft(null);
    if (!providerAvailable) {
      setActionError("Wallet provider not available.");
      return;
    }
    const hash = speedTxHashInput.trim();
    if (!hash) {
      setActionError("Enter a tx hash.");
      return;
    }
    const provider = new ethers.BrowserProvider((window as any).ethereum);
    const tx = await provider.getTransaction(hash);
    if (!tx) {
      setActionError("Could not fetch tx. Check the hash or try again.");
      return;
    }
    setSpeedDraft({
      hash,
      nonce: tx.nonce,
      to: tx.to ?? "",
      value: tx.value?.toString?.() ?? "0",
      data: tx.data ?? "0x",
    });
  };

  const sendSpeedReplacement = async (multiplier: number) => {
    setActionError("");
    setActionErrorDetails(null);
    setActionStatus("");
    setActionTxHash("");
    if (!speedDraft) {
      setActionError("Load a transaction by hash first.");
      return;
    }
    if (!isConnected || !address) {
      setActionError("Connect your wallet first.");
      return;
    }
    if (!providerAvailable) {
      setActionError("Wallet provider not available.");
      return;
    }
    const provider = new ethers.BrowserProvider((window as any).ethereum);
    const feeData = await provider.getFeeData();
    const fees = getFeePreset(multiplier, feeData);
    const txRequest: ethers.TransactionRequest = {
      to: speedDraft.to,
      from: address,
      value: BigInt(speedDraft.value || "0"),
      data: speedDraft.data || "0x",
      nonce: Number(speedDraft.nonce),
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };
    const summary = `Speed up nonce ${speedDraft.nonce} (x${multiplier.toFixed(1)})`;
    await withMainnetConfirm(summary, txRequest, async () => {
      setActionStatus("Sending replacement...");
      try {
        const signer = await provider.getSigner();
        const tx = await signer.sendTransaction(txRequest);
        setActionTxHash(tx.hash);
        setActionStatus("Sent replacement.");
        void logEvent(
          "tx_queue_speedup_sent",
          { nonce: speedDraft.nonce, multiplier, txHash: tx.hash, originalHash: speedDraft.hash },
          address ?? null,
          chainId ?? null
        );
      } catch (err: any) {
        const normalized = normalizeWalletError(err);
        setActionError(normalized.message);
        setActionErrorDetails(normalized.details);
      }
    });
  };

  const sendDemoStuckTx = async () => {
    setDemoError("");
    setDemoStatus("");
    setDemoTxHash("");
    if (!onSepolia) {
      setDemoError("Demo only available on Base Sepolia.");
      return;
    }
    if (!isConnected || !address) {
      setDemoError("Connect your wallet first.");
      return;
    }
    if (!providerAvailable) {
      setDemoError("Wallet provider not available.");
      return;
    }
    setDemoStatus("Sending demo tx...");
    const provider = new ethers.BrowserProvider((window as any).ethereum);
    const signer = await provider.getSigner();
    const nextNonce = await provider.getTransactionCount(address, "pending");
    const lowPriority = ethers.parseUnits("0.001", "gwei");
    const lowMax = ethers.parseUnits("0.01", "gwei");
    const txRequest: ethers.TransactionRequest = {
      to: address,
      from: address,
      value: 0n,
      data: "0x",
      nonce: Number(nextNonce),
      maxPriorityFeePerGas: lowPriority,
      maxFeePerGas: lowMax,
    };
    const estimate = await estimateTxCost(provider, txRequest);
    if (estimate.costEth) {
      setDemoStatus(`Estimated gas: ${estimate.costEth}`);
    } else if (estimate.error) {
      setDemoStatus("Unable to estimate; wallet will show final gas.");
    }
    try {
      const tx = await signer.sendTransaction(txRequest);
      setDemoTxHash(tx.hash);
      setDemoStatus("Now refresh queue; it should appear as pending.");
    } catch (err: any) {
      const normalized = normalizeWalletError(err);
      setDemoError(normalized.message);
    }
  };

  const formatTime = (value?: string | number) => {
    const ts = Number(value || 0);
    if (!Number.isFinite(ts) || ts <= 0) return "—";
    const date = new Date(ts * 1000);
    return date.toLocaleString();
  };

  const getStatus = (item: ActivityItem) => {
    const isError = String(item?.isError ?? "");
    const receipt = String(item?.txreceipt_status ?? "");
    if (isError === "1" || receipt === "0") return "failed";
    return "success";
  };

  const getExplorerLink = (hash?: string) => {
    if (!hash) return "";
    const base = explorerBaseUrl?.trim();
    if (!base) return "";
    return `${base.replace(/\/+$/, "")}/tx/${hash}`;
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Universal Transaction Queue (v1)</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
        <div style={{ color: "#cfcfcf" }}>
          Network: {displayChainLabel} {chainId ? `(${chainId})` : ""}
        </div>
        <button
          onClick={async () => {
            setSwitchStatus("");
            try {
              const ethereum = (window as any)?.ethereum;
              await switchToBase(ethereum);
              setSwitchStatus("Switched to Base.");
            } catch (err: any) {
              setSwitchStatus(
                `Switch failed: ${err?.message || "Unable to switch network"}. If using WalletConnect, open the wallet app and approve the change or add Base manually.`
              );
            }
          }}
        >
          Switch to Base
        </button>
        <button
          onClick={async () => {
            setSwitchStatus("");
            try {
              const ethereum = (window as any)?.ethereum;
              await switchToBaseSepolia(ethereum);
              setSwitchStatus("Switched to Base Sepolia.");
            } catch (err: any) {
              setSwitchStatus(
                `Switch failed: ${err?.message || "Unable to switch network"}. If using WalletConnect, open the wallet app and approve the change or add Base Sepolia manually.`
              );
            }
          }}
        >
          Switch to Base Sepolia
        </button>
        {switchStatus ? <div style={{ color: "#9e9e9e" }}>{switchStatus}</div> : null}
      </div>
      <div style={{ color: "#bdbdbd", marginTop: 6 }}>
        Load a wallet’s recent tx history and nonce queue status.
      </div>
      <div style={{ marginTop: 10 }}>
        <Link to="/quickpay">Back to QuickPay</Link>
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 720 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Address</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            style={{ width: "100%", maxWidth: 520, padding: 8 }}
            placeholder={defaultAddress || "0x…"}
            value={inputAddress}
            onChange={(e) => setInputAddress(e.target.value)}
          />
          <button onClick={handleLoad} disabled={nonceLoading || activityLoading}>
            {nonceLoading || activityLoading ? "Loading..." : "Load"}
          </button>
        </div>
        <div style={{ color: "#bdbdbd", marginTop: 6 }}>
          {activeAddress ? `Loaded: ${activeAddress}` : "Defaults to connected wallet if available."}
        </div>
        {!providerAvailable ? (
          <div style={{ color: "#ff7a7a", marginTop: 6 }}>Wallet provider not available.</div>
        ) : null}
        {error ? <div style={{ color: "#ff7a7a", marginTop: 8 }}>{error}</div> : null}
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 720 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Nonce snapshot</div>
        <div><strong>Chain:</strong> {chainId ?? "Not available"}</div>
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
        {queueRange ? (
          <div style={{ marginTop: 8, color: "#ffd180" }}>
            Pending nonce range: {queueRange.start} → {queueRange.end}
          </div>
        ) : (
          <div style={{ marginTop: 8, color: "#bdbdbd" }}>
            No pending nonce queue detected.
          </div>
        )}
      </div>

      {onSepolia ? (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 720 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Demo: Create Stuck Tx</div>
          <div style={{ color: "#ffb74d", marginBottom: 8 }}>
            This is for demo; you will spend small gas.
          </div>
          <button onClick={sendDemoStuckTx}>Send low-fee tx</button>
          {demoStatus ? <div style={{ marginTop: 8, color: "#bdbdbd" }}>{demoStatus}</div> : null}
          {demoTxHash ? (
            <div style={{ marginTop: 6 }}>
              Tx: {demoTxHash}
              {getExplorerLink(demoTxHash) ? (
                <>
                  {" "}
                  <a href={getExplorerLink(demoTxHash)} target="_blank" rel="noreferrer">
                    View
                  </a>
                </>
              ) : null}
            </div>
          ) : null}
          {demoError ? <div style={{ color: "#ff7a7a", marginTop: 6 }}>{demoError}</div> : null}
        </div>
      ) : null}

      {activityRows.length ? (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 720 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Queue Analyzer</div>
          <div><strong>Highest confirmed nonce:</strong> {highestConfirmedNonce ?? "—"}</div>
          <div><strong>Likely stuck nonce:</strong> {queueRange ? nonceLatest : "—"}</div>
          <div><strong>Queue length:</strong> {queueLength}</div>
          {queueRange ? (
            <div style={{ marginTop: 8 }}>
              <button
                onClick={() => navigator.clipboard?.writeText(String(nonceLatest))}
              >
                Copy nonce {nonceLatest}
              </button>
            </div>
          ) : null}
          <div style={{ marginTop: 10, color: "#bdbdbd" }}>
            If you don’t know which nonce is stuck: usually nonceLatest is the blocker.
          </div>
          <div style={{ marginTop: 6, color: "#bdbdbd" }}>
            Replacement must have the SAME nonce and HIGHER fees.
          </div>
        </div>
      ) : null}

      {queueRange ? (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 720 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Suggested Fix</div>
          <div style={{ color: "#bdbdbd", marginBottom: 8 }}>
            Suggested action: Cancel nonce {nonceLatest}. Replace the same nonce with 0 ETH to yourself and higher fees.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[1.2, 1.5, 2.0].map((multiplier) => (
              <button
                key={multiplier}
                onClick={() => sendCancelReplacement(multiplier)}
              >
                Cancel nonce {nonceLatest} (x{multiplier.toFixed(1)})
              </button>
            ))}
          </div>
          {actionStatus ? <div style={{ marginTop: 8, color: "#bdbdbd" }}>{actionStatus}</div> : null}
          {actionTxHash ? (
            <div style={{ marginTop: 6 }}>
              Tx: {actionTxHash}
              {getExplorerLink(actionTxHash) ? (
                <>
                  {" "}
                  <a href={getExplorerLink(actionTxHash)} target="_blank" rel="noreferrer">
                    View
                  </a>
                </>
              ) : null}
            </div>
          ) : null}
          {actionError ? (
            <div style={{ color: "#ff7a7a", marginTop: 6 }}>
              {actionError}
              {actionErrorDetails ? (
                <details style={{ marginTop: 6, color: "#bdbdbd" }}>
                  <summary style={{ cursor: "pointer" }}>Technical details</summary>
                  <div style={{ marginTop: 4 }}>{actionErrorDetails}</div>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 720 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Speed-up by hash</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            style={{ width: "100%", maxWidth: 520, padding: 8 }}
            placeholder="0x… tx hash"
            value={speedTxHashInput}
            onChange={(e) => setSpeedTxHashInput(e.target.value)}
          />
          <button onClick={fetchSpeedDraft}>Load</button>
        </div>
        {speedDraft ? (
          <div style={{ marginTop: 10, color: "#bdbdbd" }}>
            <div><strong>Nonce:</strong> {speedDraft.nonce}</div>
            <div><strong>To:</strong> {speedDraft.to || "—"}</div>
            <div><strong>Value (wei):</strong> {speedDraft.value}</div>
            <div>
              <strong>Data:</strong>{" "}
              {String(speedDraft.data || "").length > 66
                ? `${String(speedDraft.data).slice(0, 66)}…`
                : String(speedDraft.data || "")}
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[1.2, 1.5, 2.0].map((multiplier) => (
                <button
                  key={multiplier}
                  onClick={() => sendSpeedReplacement(multiplier)}
                >
                  Speed up (x{multiplier.toFixed(1)})
                </button>
              ))}
            </div>
          </div>
        ) : null}
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

      <div style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Recent transactions</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "8px 6px", borderBottom: "1px solid #333" }}>Time</th>
                <th style={{ padding: "8px 6px", borderBottom: "1px solid #333" }}>Nonce</th>
                <th style={{ padding: "8px 6px", borderBottom: "1px solid #333" }}>To</th>
                <th style={{ padding: "8px 6px", borderBottom: "1px solid #333" }}>Status</th>
                <th style={{ padding: "8px 6px", borderBottom: "1px solid #333" }}>Hash</th>
              </tr>
            </thead>
            <tbody>
              {activityRows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 10, color: "#bdbdbd" }}>
                    {activityLoading ? "Loading activity..." : "No transactions loaded."}
                  </td>
                </tr>
              ) : (
                activityRows.map((item, idx) => {
                  const nonceValue = Number(item?.nonce ?? NaN);
                  const inQueue =
                    queueRange && Number.isFinite(nonceValue)
                      ? nonceValue >= queueRange.start && nonceValue <= queueRange.end
                      : false;
                  const status = getStatus(item);
                  const link = getExplorerLink(String(item?.hash || ""));
                  return (
                    <tr
                      key={`${item?.hash || "row"}-${idx}`}
                      style={{
                        background: inQueue ? "#2b2416" : undefined,
                        color: inQueue ? "#ffd180" : undefined,
                      }}
                    >
                      <td style={{ padding: "6px" }}>{formatTime(item?.timeStamp)}</td>
                      <td style={{ padding: "6px" }}>{Number.isFinite(nonceValue) ? nonceValue : "—"}</td>
                      <td style={{ padding: "6px" }}>{item?.to || "—"}</td>
                      <td style={{ padding: "6px", color: status === "failed" ? "#ff7a7a" : "#b6f7c1" }}>
                        {status}
                      </td>
                      <td style={{ padding: "6px" }}>
                        {link ? (
                          <a href={link} target="_blank" rel="noreferrer">
                            {String(item?.hash || "").slice(0, 10)}… (Open)
                          </a>
                        ) : (
                          String(item?.hash || "").slice(0, 12)
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
