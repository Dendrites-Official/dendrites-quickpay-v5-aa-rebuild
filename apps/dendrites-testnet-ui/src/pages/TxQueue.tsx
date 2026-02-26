import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { qpUrl } from "../lib/quickpayApiBase";
import { logEvent } from "../lib/analytics";
import MainnetConfirmModal from "../components/MainnetConfirmModal";
import { buildEip1559Fees, estimateTxCost } from "../lib/txEstimate";
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
    const fees = await buildEip1559Fees(provider, multiplier);
    const txRequest: ethers.TransactionRequest = {
      to: address,
      from: address,
      value: 0n,
      data: "0x",
      nonce: nonceLatest,
      gasLimit: 21000n,
      ...(fees.mode === "eip1559"
        ? { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }
        : { gasPrice: fees.gasPrice }),
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
        const formatted = formatReplacementError(err);
        setActionError(formatted.message);
        setActionErrorDetails(formatted.details ?? null);
      }
    });
  };

  const fetchSpeedDraft = async () => {
    setActionError("");
    setActionErrorDetails(null);
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
    const receipt = await provider.getTransactionReceipt(hash);
    let latestNonce = nonceLatest;
    if (latestNonce == null && address) {
      try {
        latestNonce = Number(await provider.getTransactionCount(address, "latest"));
      } catch {
        latestNonce = null;
      }
    }
    let disabledReason = "";
    if (receipt?.blockNumber) {
      disabledReason = "Tx already confirmed; cannot replace. Use a pending tx hash.";
    } else if (latestNonce != null && Number(tx.nonce) < latestNonce) {
      disabledReason = "Tx already confirmed; cannot replace. Use a pending tx hash.";
    }
    setSpeedDraft({
      hash,
      nonce: tx.nonce,
      to: tx.to ?? "",
      value: tx.value?.toString?.() ?? "0",
      data: tx.data ?? "0x",
      maxFeePerGas: tx.maxFeePerGas?.toString?.() ?? null,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString?.() ?? null,
      gasPrice: tx.gasPrice?.toString?.() ?? null,
      disabledReason,
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
    if (speedDraft?.disabledReason) {
      setActionError(speedDraft.disabledReason);
      return;
    }
    const provider = new ethers.BrowserProvider((window as any).ethereum);
    const previousFees = {
      maxFeePerGas: speedDraft.maxFeePerGas ? BigInt(speedDraft.maxFeePerGas) : null,
      maxPriorityFeePerGas: speedDraft.maxPriorityFeePerGas ? BigInt(speedDraft.maxPriorityFeePerGas) : null,
      gasPrice: speedDraft.gasPrice ? BigInt(speedDraft.gasPrice) : null,
    };
    const fees = await buildEip1559Fees(provider, multiplier, previousFees);
    const txRequest: ethers.TransactionRequest = {
      to: speedDraft.to,
      from: address,
      value: BigInt(speedDraft.value || "0"),
      data: speedDraft.data || "0x",
      nonce: Number(speedDraft.nonce),
      ...(fees.mode === "eip1559"
        ? { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }
        : { gasPrice: fees.gasPrice }),
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
        const formatted = formatReplacementError(err);
        setActionError(formatted.message);
        setActionErrorDetails(formatted.details ?? null);
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
    const latestBlock = await provider.getBlock("latest");
    const baseFee = latestBlock?.baseFeePerGas ?? null;
    const lowPriority = 0n;
    const lowMax = baseFee ? baseFee / 4n : ethers.parseUnits("0.01", "gwei");
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
      try {
        await Promise.all([loadNonces(address), loadActivity(address)]);
      } catch {
        // ignore refresh errors
      }
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
  <main className="dx-container">
    <header className="dx-pageHead">
      <div className="dx-kicker">DENDRITES</div>

      <div className="dx-headRow">
        <div>
          <h1 className="dx-h1">Tx Queue</h1>
          <p className="dx-sub">Load a wallet’s recent tx history and nonce queue status.</p>
        </div>

        <div className="dx-headMeta">
          <span className="dx-pill dx-pillBlue">
            {displayChainLabel} {chainId ? `(${chainId})` : ""}
          </span>
          <span className="dx-pill">{providerAvailable ? "Provider detected" : "No provider"}</span>
        </div>
      </div>

      <div className="dx-headLinks">
        <button
          className="dx-miniBtn"
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
          className="dx-miniBtn"
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

        <Link className="dx-miniLink" to="/quickpay">
          Back to QuickPay
        </Link>
      </div>

      {switchStatus ? <div className="dx-alert" style={{ marginTop: 12 }}>{switchStatus}</div> : null}
    </header>

    <div className="dx-stack" style={{ marginTop: 14 }}>
      {/* Address */}
      <section className="dx-card">
        <div className="dx-card-in">
          <div className="dx-card-head">
            <h2 className="dx-card-title">Address</h2>
            <p className="dx-card-hint">Load</p>
          </div>

          <div className="dx-rowInline" style={{ gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="dx-field">
                <span className="dx-label">Wallet</span>
                <input
                  placeholder={defaultAddress || "0x…"}
                  value={inputAddress}
                  onChange={(e) => setInputAddress(e.target.value)}
                />
                <div className="dx-help">
                  {activeAddress ? `Loaded: ${activeAddress}` : "Defaults to connected wallet if available."}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="dx-primary" onClick={handleLoad} disabled={nonceLoading || activityLoading}>
                {nonceLoading || activityLoading ? "Loading…" : "Load"}
              </button>
            </div>
          </div>

          {!providerAvailable ? (
            <div className="dx-alert dx-alert-danger" style={{ marginTop: 10 }}>
              Wallet provider not available.
            </div>
          ) : null}

          {error ? (
            <div className="dx-alert dx-alert-danger" style={{ marginTop: 10 }}>
              {error}
            </div>
          ) : null}
        </div>
      </section>

      {/* Nonce snapshot */}
      <section className="dx-card">
        <div className="dx-card-in">
          <div className="dx-card-head">
            <h2 className="dx-card-title">Nonce snapshot</h2>
            <p className="dx-card-hint">Live</p>
          </div>

          <div className="dx-section">
            <div className="dx-kv">
              <div className="dx-k">Chain</div>
              <div className="dx-v">{chainId ?? "Not available"}</div>

              <div className="dx-k">Nonce (latest)</div>
              <div className="dx-v">
                <div className="dx-rowInline">
                  <span>{nonceLatest ?? "—"}</span>
                  {nonceLatest != null ? (
                    <button className="dx-copyBtn" onClick={() => navigator.clipboard?.writeText(String(nonceLatest))}>
                      Copy
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="dx-k">Nonce (pending)</div>
              <div className="dx-v">
                <div className="dx-rowInline">
                  <span>{noncePending ?? "—"}</span>
                  {noncePending != null ? (
                    <button className="dx-copyBtn" onClick={() => navigator.clipboard?.writeText(String(noncePending))}>
                      Copy
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="dx-divider" />

            {queueRange ? (
              <div className="dx-alert dx-alert-warn">
                Pending nonce range: {queueRange.start} → {queueRange.end}
              </div>
            ) : (
              <div className="dx-muted">No pending nonce queue detected.</div>
            )}
          </div>
        </div>
      </section>

      {/* Demo */}
      {onSepolia ? (
        <section className="dx-card">
          <div className="dx-card-in">
            <div className="dx-card-head">
              <h2 className="dx-card-title">Demo</h2>
              <p className="dx-card-hint">Base Sepolia only</p>
            </div>

            <div className="dx-alert dx-alert-warn">This is for demo; you will spend small gas.</div>

            <div className="dx-actions" style={{ marginTop: 10 }}>
              <button className="dx-primary" onClick={sendDemoStuckTx}>
                Send low-fee tx
              </button>
            </div>

            {demoStatus ? <div className="dx-muted" style={{ marginTop: 10 }}>{demoStatus}</div> : null}

            {demoTxHash ? (
              <div style={{ marginTop: 10 }}>
                <div className="dx-rowInline">
                  <span className="dx-muted">Tx:</span>
                  <span className="dx-mono">{demoTxHash}</span>
                  {getExplorerLink(demoTxHash) ? (
                    <a className="dx-linkBtn" href={getExplorerLink(demoTxHash)} target="_blank" rel="noreferrer">
                      View
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}

            {demoError ? <div className="dx-alert dx-alert-danger" style={{ marginTop: 10 }}>{demoError}</div> : null}
          </div>
        </section>
      ) : null}

      {/* Analyzer */}
      {activityRows.length ? (
        <section className="dx-card">
          <div className="dx-card-in">
            <div className="dx-card-head">
              <h2 className="dx-card-title">Queue Analyzer</h2>
              <p className="dx-card-hint">Insights</p>
            </div>

            <div className="dx-section">
              <div className="dx-kv">
                <div className="dx-k">Highest confirmed nonce</div>
                <div className="dx-v">{highestConfirmedNonce ?? "—"}</div>

                <div className="dx-k">Likely stuck nonce</div>
                <div className="dx-v">{queueRange ? nonceLatest : "—"}</div>

                <div className="dx-k">Queue length</div>
                <div className="dx-v">{queueLength}</div>
              </div>

              {queueRange ? (
                <div className="dx-btnRow" style={{ marginTop: 12 }}>
                  <button className="dx-copyBtn" onClick={() => navigator.clipboard?.writeText(String(nonceLatest))}>
                    Copy nonce {nonceLatest}
                  </button>
                </div>
              ) : null}

              <div className="dx-muted" style={{ marginTop: 10 }}>
                If you don’t know which nonce is stuck: usually nonceLatest is the blocker.
              </div>
              <div className="dx-muted" style={{ marginTop: 6 }}>
                Replacement must have the SAME nonce and HIGHER fees.
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Suggested Fix */}
      {queueRange ? (
        <section className="dx-card">
          <div className="dx-card-in">
            <div className="dx-card-head">
              <h2 className="dx-card-title">Suggested Fix</h2>
              <p className="dx-card-hint">Cancel</p>
            </div>

            <div className="dx-alert">
              Suggested action: Cancel nonce {nonceLatest}. Replace the same nonce with 0 ETH to yourself and higher fees.
            </div>

            <div className="dx-actions" style={{ marginTop: 10 }}>
              {[1.2, 1.5, 2.0].map((multiplier) => (
                <button key={multiplier} onClick={() => sendCancelReplacement(multiplier)}>
                  Cancel nonce {nonceLatest} (x{multiplier.toFixed(1)})
                </button>
              ))}
            </div>

            {actionStatus ? <div className="dx-muted" style={{ marginTop: 10 }}>{actionStatus}</div> : null}

            {actionTxHash ? (
              <div style={{ marginTop: 10 }}>
                <div className="dx-rowInline">
                  <span className="dx-muted">Tx:</span>
                  <span className="dx-mono">{actionTxHash}</span>
                  {getExplorerLink(actionTxHash) ? (
                    <a className="dx-linkBtn" href={getExplorerLink(actionTxHash)} target="_blank" rel="noreferrer">
                      View
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}

            {actionError ? (
              <div className="dx-alert dx-alert-danger" style={{ marginTop: 10 }}>
                {actionError}
                {actionErrorDetails ? (
                  <details style={{ marginTop: 8 }}>
                    <summary className="dx-muted">Technical details</summary>
                    <div style={{ marginTop: 8 }} className="dx-muted">
                      {actionErrorDetails}
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Speed-up by hash */}
      <section className="dx-card">
        <div className="dx-card-in">
          <div className="dx-card-head">
            <h2 className="dx-card-title">Speed-up by hash</h2>
            <p className="dx-card-hint">Replace</p>
          </div>

          <div className="dx-rowInline" style={{ gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="dx-field">
                <span className="dx-label">Tx hash</span>
                <input
                  className="dx-mono"
                  placeholder="0x… tx hash"
                  value={speedTxHashInput}
                  onChange={(e) => setSpeedTxHashInput(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button className="dx-primary" onClick={fetchSpeedDraft}>
                Load
              </button>
            </div>
          </div>

          {speedDraft ? (
            <div className="dx-section" style={{ marginTop: 12 }}>
              <div className="dx-kv">
                <div className="dx-k">Nonce</div>
                <div className="dx-v">{speedDraft.nonce}</div>

                <div className="dx-k">To</div>
                <div className="dx-v dx-mono">{speedDraft.to || "—"}</div>

                <div className="dx-k">Value (wei)</div>
                <div className="dx-v dx-mono">{speedDraft.value}</div>

                <div className="dx-k">Data</div>
                <div className="dx-v dx-mono">
                  {String(speedDraft.data || "").length > 66
                    ? `${String(speedDraft.data).slice(0, 66)}…`
                    : String(speedDraft.data || "")}
                </div>
              </div>

              {speedDraft.disabledReason ? (
                <div className="dx-alert dx-alert-warn" style={{ marginTop: 10 }}>
                  {speedDraft.disabledReason}
                </div>
              ) : null}

              <div className="dx-actions" style={{ marginTop: 10 }}>
                {[1.2, 1.5, 2.0].map((multiplier) => (
                  <button
                    key={multiplier}
                    onClick={() => sendSpeedReplacement(multiplier)}
                    disabled={Boolean(speedDraft.disabledReason)}
                  >
                    Speed up (x{multiplier.toFixed(1)})
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Recent transactions table */}
      <section className="dx-card">
        <div className="dx-card-in">
          <div className="dx-card-head">
            <h2 className="dx-card-title">Recent transactions</h2>
            <p className="dx-card-hint">{activityLoading ? "Loading…" : "Table"}</p>
          </div>

          <div className="dx-tableWrap">
            <div className="dx-tableScroll">
              <table className="dx-table">
                <thead>
                  <tr>
                    <th className="dx-th">Time</th>
                    <th className="dx-th">Nonce</th>
                    <th className="dx-th">To</th>
                    <th className="dx-th">Status</th>
                    <th className="dx-th">Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {activityRows.length === 0 ? (
                    <tr>
                      <td className="dx-td" colSpan={5}>
                        <span className="dx-muted">
                          {activityLoading ? "Loading activity…" : "No transactions loaded."}
                        </span>
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
                      const chip =
                        status === "failed" ? "dx-chip dx-chipBad" : "dx-chip dx-chipOk";

                      return (
                        <tr
                          key={`${item?.hash || "row"}-${idx}`}
                          className={`dx-row ${inQueue ? "dx-rowWarn" : ""}`}
                        >
                          <td className="dx-td">{formatTime(item?.timeStamp)}</td>
                          <td className="dx-td">{Number.isFinite(nonceValue) ? nonceValue : "—"}</td>
                          <td className="dx-td dx-mono">{item?.to || "—"}</td>
                          <td className="dx-td">
                            <span className={chip}>{status}</span>
                            {inQueue ? <span className="dx-pill" style={{ marginLeft: 10 }}>in queue</span> : null}
                          </td>
                          <td className="dx-td">
                            {link ? (
                              <a className="dx-miniLink" href={link} target="_blank" rel="noreferrer">
                                {String(item?.hash || "").slice(0, 10)}… Open
                              </a>
                            ) : (
                              <span className="dx-mono">{String(item?.hash || "").slice(0, 12)}</span>
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

          {/* Action errors shown in cards already; keep modal logic untouched */}
        </div>
      </section>
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
  </main>
);

}
