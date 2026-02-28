import { useCallback, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { qpUrl } from "../lib/quickpayApiBase";
import { useAppMode } from "../demo/AppModeContext";
import { useWalletState } from "../demo/useWalletState";

type QAStatus = "PASS" | "FAIL" | "WARN";

type QAResult = {
  name: string;
  status: QAStatus;
  details: string;
  fix: string;
  durationMs: number;
};

type ProbeResult = {
  ok?: boolean;
  chainSupport?: Record<string, boolean>;
  blockscoutConfigured?: Record<string, boolean>;
  now?: string;
};

type WriteStepStatus = "PENDING" | "PASS" | "FAIL" | "WARN";
type WriteStep = {
  step: string;
  status: WriteStepStatus;
  details: string;
};

const READ_ONLY_RPC: Record<number, string> = {
  8453: "https://mainnet.base.org",
  84532: "https://sepolia.base.org",
};

const statusColor: Record<QAStatus, string> = {
  PASS: "#36c96f",
  WARN: "#f7b731",
  FAIL: "#ff6b6b",
};

function formatMs(ms: number) {
  return `${Math.round(ms)} ms`;
}

export default function WalletQA() {
  const { isDemo } = useAppMode();
  const { address, isConnected, chainId } = useWalletState();
  const [addressInput, setAddressInput] = useState("");
  const [chainInput, setChainInput] = useState<number>(84532);
  const [results, setResults] = useState<QAResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [envProbe, setEnvProbe] = useState<ProbeResult | null>(null);
  const [writeEnabled, setWriteEnabled] = useState(false);
  const [writeRunning, setWriteRunning] = useState(false);
  const [writeSteps, setWriteSteps] = useState<WriteStep[]>([]);
  const [writeError, setWriteError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const lastRunRef = useRef<{ address: string; chainId: number } | null>(null);

  const selectedAddress = useMemo(() => {
    if (isConnected && address) return address;
    return addressInput.trim();
  }, [address, addressInput, isConnected]);

  const selectedChainId = useMemo(() => {
    if (isConnected && chainId) return chainId;
    return chainInput;
  }, [chainId, chainInput, isConnected]);

  const totalSummary = useMemo(() => {
    const summary = { PASS: 0, WARN: 0, FAIL: 0 } as Record<QAStatus, number>;
    for (const row of results) {
      summary[row.status] += 1;
    }
    return summary;
  }, [results]);

  const updateWriteStep = useCallback((step: string, status: WriteStepStatus, details: string) => {
    setWriteSteps((prev) => {
      const next = [...prev];
      const idx = next.findIndex((row) => row.step === step);
      if (idx >= 0) {
        next[idx] = { step, status, details };
      } else {
        next.push({ step, status, details });
      }
      return next;
    });
  }, []);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const runChecks = useCallback(async () => {
    setError("");
    setResults([]);
    setEnvProbe(null);

    if (isDemo) {
      setResults([
        {
          name: "Demo mode",
          status: "WARN",
          details: "Wallet QA checks are disabled in demo mode.",
          fix: "Turn off Demo mode to run live checks.",
          durationMs: 0,
        },
      ]);
      return;
    }

    if (!selectedAddress || !ethers.isAddress(selectedAddress)) {
      setError("Enter a valid address or connect a wallet.");
      return;
    }
    if (![8453, 84532].includes(selectedChainId)) {
      setError("Select Base Mainnet (8453) or Base Sepolia (84532).");
      return;
    }

    setLoading(true);
    const nextResults: QAResult[] = [];

    const pushResult = (result: QAResult) => {
      nextResults.push(result);
      setResults([...nextResults]);
    };

    const runTimed = async (name: string, action: () => Promise<Omit<QAResult, "name" | "durationMs">>) => {
      const start = performance.now();
      try {
        const result = await action();
        pushResult({ name, durationMs: performance.now() - start, ...result });
      } catch (err: any) {
        pushResult({
          name,
          status: "FAIL",
          details: `Unexpected error: ${err?.message || "unknown"}`,
          fix: "Check network and try again.",
          durationMs: performance.now() - start,
        });
      }
    };

    let provider: ethers.AbstractProvider | null = null;
    let nonceLatest: number | null = null;
    let noncePending: number | null = null;
    let approvalsTokens: any[] = [];
    let activityItems: any[] = [];
    let txQueueSimulationOk = false;

    await runTimed("Provider check", async () => {
      if (isConnected) {
        const ethereum = (window as any)?.ethereum;
        if (!ethereum) {
          return {
            status: "FAIL",
            details: "Wallet provider not detected",
            fix: "Ensure a wallet extension is installed and unlocked.",
          };
        }
        provider = new ethers.BrowserProvider(ethereum);
        return {
          status: "PASS",
          details: "Wallet provider detected",
          fix: "None",
        };
      }

      const rpcUrl = READ_ONLY_RPC[selectedChainId];
      if (!rpcUrl) {
        return {
          status: "WARN",
          details: "Read-only mode: no RPC URL configured.",
          fix: "Provide a supported chain or connect a wallet.",
        };
      }
      provider = new ethers.JsonRpcProvider(rpcUrl, selectedChainId);
      return {
        status: "WARN",
        details: "Read-only mode: using public RPC",
        fix: "Connect a wallet to verify signer actions.",
      };
    });

    await runTimed("Chain support check", async () => {
      const res = await fetch(qpUrl("/wallet/probe"));
      const data = (await res.json().catch(() => ({}))) as ProbeResult;
      setEnvProbe(data);
      const support = Boolean(data?.chainSupport?.[String(selectedChainId)]);
      if (!res.ok || data?.ok === false) {
        return {
          status: "FAIL",
          details: "Probe failed",
          fix: "Deploy API and ensure /wallet/probe is reachable.",
        };
      }
      if (!support) {
        return {
          status: "FAIL",
          details: `Chain ${selectedChainId} not supported`,
          fix: "Update API to support this chain.",
        };
      }
      const blockscoutConfigured = Boolean(data?.blockscoutConfigured?.[String(selectedChainId)]);
      const configNote = blockscoutConfigured ? "configured" : "missing";
      return {
        status: blockscoutConfigured ? "PASS" : "WARN",
        details: `Chain supported; Blockscout ${configNote}`,
        fix: blockscoutConfigured ? "None" : "Set Blockscout env vars for this chain.",
      };
    });

    await runTimed("Activity txlist check", async () => {
      const url = qpUrl(
        `/wallet/activity/txlist?address=${selectedAddress}&chainId=${selectedChainId}&page=1&offset=10&sort=desc`
      );
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        return {
          status: "FAIL",
          details: data?.error ? String(data.error) : `HTTP ${res.status}`,
          fix: "Verify Blockscout envs and API reachability.",
        };
      }
      activityItems = Array.isArray(data?.items) ? data.items : [];
      if (activityItems.length === 0) {
        return {
          status: "WARN",
          details: "No activity found for address.",
          fix: "Use a wallet with recent activity or wait for indexing.",
        };
      }
      return {
        status: "PASS",
        details: `Loaded ${activityItems.length} txs`,
        fix: "None",
      };
    });

    await runTimed("Token tx (tokentx) check", async () => {
      const url = qpUrl(
        `/wallet/activity/tokentx?address=${selectedAddress}&chainId=${selectedChainId}&page=1&offset=10&sort=desc`
      );
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        return {
          status: "FAIL",
          details: data?.error ? String(data.error) : `HTTP ${res.status}`,
          fix: "Verify Blockscout envs and API reachability.",
        };
      }
      return {
        status: "PASS",
        details: "Token tx endpoint reachable",
        fix: "None",
      };
    });

    await runTimed("Nonce snapshot check", async () => {
      if (!provider) {
        return {
          status: "FAIL",
          details: "Provider unavailable",
          fix: "Connect a wallet or configure read-only RPC.",
        };
      }
      const latest = await provider.getTransactionCount(selectedAddress, "latest");
      const pending = await provider.getTransactionCount(selectedAddress, "pending");
      nonceLatest = Number(latest);
      noncePending = Number(pending);
      if (pending > latest) {
        return {
          status: "WARN",
          details: `latest=${latest}, pending=${pending} (pending queue detected)`,
          fix: "Use Tx Queue or Nonce Rescue to clear pending txs.",
        };
      }
      return {
        status: "PASS",
        details: `latest=${latest}, pending=${pending}`,
        fix: "None",
      };
    });

    await runTimed("Approvals scan check", async () => {
      const res = await fetch(qpUrl("/wallet/approvals/scan"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId: selectedChainId, owner: selectedAddress, maxTokens: 10 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        return {
          status: "FAIL",
          details: data?.error ? String(data.error) : `HTTP ${res.status}`,
          fix: "Ensure approvals scanner envs/RPC are configured.",
        };
      }
      approvalsTokens = Array.isArray(data?.tokens) ? data.tokens : [];
      return {
        status: "PASS",
        details: `Scanned ${approvalsTokens.length} tokens`,
        fix: "None",
      };
    });

    await runTimed("Tx Queue simulation", async () => {
      if (!provider || nonceLatest == null) {
        return {
          status: "WARN",
          details: "Missing provider or nonce snapshot",
          fix: "Connect a wallet or re-run nonce check.",
        };
      }
      try {
        const txRequest: ethers.TransactionRequest = {
          to: selectedAddress,
          from: selectedAddress,
          value: 0n,
          data: "0x",
          nonce: nonceLatest,
        };
        const gas = await provider.estimateGas(txRequest);
        txQueueSimulationOk = true;
        return {
          status: "PASS",
          details: `Estimated gas: ${gas.toString()}`,
          fix: "None",
        };
      } catch (err: any) {
        return {
          status: "WARN",
          details: `Estimate failed: ${err?.message || "unknown"}`,
          fix: "Retry with a wallet provider or different RPC.",
        };
      }
    });

    await runTimed("Nonce Rescue readiness", async () => {
      if (txQueueSimulationOk || (nonceLatest != null && noncePending != null)) {
        return {
          status: "PASS",
          details: txQueueSimulationOk
            ? "Tx Queue simulation ready"
            : "Nonce snapshot available",
          fix: "None",
        };
      }
      return {
        status: "FAIL",
        details: "Missing nonce data",
        fix: "Run nonce snapshot or connect a wallet.",
      };
    });

    await runTimed("Risk tab signals derivation", async () => {
      const pendingRisk = nonceLatest != null && noncePending != null && noncePending > nonceLatest;

      let unlimitedCount = 0;
      for (const token of approvalsTokens) {
        if (!token?.allowances || token?.error) continue;
        for (const allowance of token.allowances) {
          if (allowance?.isUnlimited) unlimitedCount += 1;
        }
      }

      let unknownContractsCount: number | null = null;
      if (provider && activityItems.length > 0) {
        const uniqueTo = Array.from(
          new Set(
            activityItems
              .map((item) => String(item?.to || "").trim())
              .filter((value) => ethers.isAddress(value))
          )
        ).slice(0, 10);
        try {
          let count = 0;
          for (const addr of uniqueTo) {
            const code = await provider.getCode(addr);
            if (code && code !== "0x") count += 1;
          }
          unknownContractsCount = count;
        } catch {
          unknownContractsCount = null;
        }
      }

      if (unknownContractsCount == null && activityItems.length > 0) {
        return {
          status: "WARN",
          details: "Pending risk computed, but contract scan failed.",
          fix: "Check RPC connectivity and try again.",
        };
      }

      const details = [
        `pendingRisk=${pendingRisk ? "true" : "false"}`,
        `unlimitedApprovals=${unlimitedCount}`,
        `unknownContracts=${unknownContractsCount ?? "n/a"}`,
      ].join(", ");

      return {
        status: "PASS",
        details,
        fix: "None",
      };
    });

    lastRunRef.current = { address: selectedAddress, chainId: selectedChainId };
    setLoading(false);

    const summary = {
      pass: nextResults.filter((row) => row.status === "PASS").length,
      warn: nextResults.filter((row) => row.status === "WARN").length,
      fail: nextResults.filter((row) => row.status === "FAIL").length,
    };
    console.info("Wallet QA summary", {
      address: selectedAddress,
      chainId: selectedChainId,
      ...summary,
    });
  }, [address, chainId, isConnected, isDemo, selectedAddress, selectedChainId]);

  const handleExport = useCallback(() => {
    if (!results.length) return;
    const payload = {
      timestamp: new Date().toISOString(),
      chainId: selectedChainId,
      address: selectedAddress,
      results,
      envProbe,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wallet-qa-${selectedChainId}-${selectedAddress.slice(0, 6)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [envProbe, results, selectedAddress, selectedChainId]);

  const runWriteTest = useCallback(async () => {
    setWriteError("");
    setWriteSteps([]);

    if (isDemo) {
      setWriteError("Demo mode: write tests are disabled.");
      return;
    }

    if (!writeEnabled) {
      setWriteError("Enable write tests first.");
      return;
    }
    if (!isConnected || !address) {
      setWriteError("Connect a wallet to run write tests.");
      return;
    }
    if (selectedChainId !== 84532) {
      setWriteError("Write tests are only supported on Base Sepolia (84532).");
      return;
    }

    const ethereum = (window as any)?.ethereum;
    if (!ethereum) {
      setWriteError("Wallet provider not available.");
      return;
    }

    setWriteRunning(true);
    const provider = new ethers.BrowserProvider(ethereum);
    const signer = await provider.getSigner();

    try {
      updateWriteStep("Step 1: create pending tx", "PENDING", "Sending low-fee transaction...");
      const latestBlock = await provider.getBlock("latest");
      const baseFee = latestBlock?.baseFeePerGas;
      if (!baseFee) {
        updateWriteStep("Step 1: create pending tx", "FAIL", "Missing baseFeePerGas on latest block.");
        setWriteRunning(false);
        return;
      }
      const pendingNonce = await provider.getTransactionCount(address, "pending");
      const lowMaxFee = baseFee / 4n || 1n;
      const lowPriority = 0n;
      const pendingTx = await signer.sendTransaction({
        to: address,
        from: address,
        value: 0n,
        data: "0x",
        nonce: Number(pendingNonce),
        gasLimit: 21000n,
        maxPriorityFeePerGas: lowPriority,
        maxFeePerGas: lowMaxFee,
      });
      updateWriteStep(
        "Step 1: create pending tx",
        "PASS",
        `Pending tx hash: ${pendingTx.hash}`
      );

      await sleep(2000);
      const quickReceipt = await provider.getTransactionReceipt(pendingTx.hash);
      if (quickReceipt?.blockNumber) {
        updateWriteStep(
          "Step 1: create pending tx",
          "WARN",
          "Pending tx mined too quickly; rerun test."
        );
        setWriteRunning(false);
        return;
      }

      updateWriteStep("Step 2: send replacement cancel", "PENDING", "Submitting replacement...");
      const feeData = await provider.getFeeData();
      const minPriority = ethers.parseUnits("1.5", "gwei");
      let priority = feeData.maxPriorityFeePerGas ?? minPriority;
      if (priority < minPriority) priority = minPriority;
      let maxFee = baseFee * 2n + priority;

      const bump = (value: bigint) => (value * 1125n) / 1000n;
      const bumpedPriority = bump(lowPriority);
      const bumpedMaxFee = bump(lowMaxFee);
      if (priority < bumpedPriority) priority = bumpedPriority;
      if (maxFee < bumpedMaxFee) maxFee = bumpedMaxFee;

      if (maxFee < baseFee * 2n + priority) {
        maxFee = baseFee * 2n + priority;
      }

      const replacementTx = await signer.sendTransaction({
        to: address,
        from: address,
        value: 0n,
        data: "0x",
        nonce: Number(pendingNonce),
        gasLimit: 21000n,
        maxPriorityFeePerGas: priority,
        maxFeePerGas: maxFee,
      });
      updateWriteStep(
        "Step 2: send replacement cancel",
        "PASS",
        `Replacement tx hash: ${replacementTx.hash}`
      );

      updateWriteStep("Step 3: verify replacement mined", "PENDING", "Waiting for receipt (up to 60s)...");
      const start = Date.now();
      let receipt = null as any;
      while (Date.now() - start < 60000) {
        receipt = await provider.getTransactionReceipt(replacementTx.hash);
        if (receipt) break;
        await sleep(3000);
      }
      if (!receipt?.blockNumber) {
        updateWriteStep("Step 3: verify replacement mined", "FAIL", "Timeout waiting for receipt.");
        setWriteRunning(false);
        return;
      }
      if (receipt.status === 0) {
        updateWriteStep("Step 3: verify replacement mined", "FAIL", "Replacement tx failed.");
        setWriteRunning(false);
        return;
      }
      updateWriteStep("Step 3: verify replacement mined", "PASS", "Replacement confirmed." );

      updateWriteStep("Step 4: verify queue cleared", "PENDING", "Checking nonces...");
      const latestNonce = await provider.getTransactionCount(address, "latest");
      const pendingNonce2 = await provider.getTransactionCount(address, "pending");
      if (pendingNonce2 === latestNonce) {
        updateWriteStep("Step 4: verify queue cleared", "PASS", `pending=${pendingNonce2}, latest=${latestNonce}`);
      } else {
        updateWriteStep("Step 4: verify queue cleared", "WARN", `pending=${pendingNonce2}, latest=${latestNonce}`);
      }
    } catch (err: any) {
      updateWriteStep("Step 1: create pending tx", "FAIL", err?.message || "Write test failed.");
      setWriteError(err?.message || "Write test failed.");
    } finally {
      setWriteRunning(false);
    }
  }, [address, isConnected, isDemo, selectedChainId, updateWriteStep, writeEnabled]);

 return (
  <div className="dx-container">
    <div className="dx-kicker">Utilities</div>
    <h1 className="dx-h1">Wallet QA Harness</h1>
    <div className="dx-sub">
      Internal checks for Wallet Health, Activity, Approvals, Risk, Tx Queue, and Nonce Rescue.
    </div>

    {isDemo ? (
      <div className="dx-alert" style={{ marginTop: 12 }}>
        Demo mode: Wallet QA uses live RPC and API checks. Disable Demo mode to run tests.
      </div>
    ) : null}

    <div className="dx-grid">
      {/* Input */}
      <div className="dx-card">
        <div className="dx-card-in">
          <div className="dx-card-head">
            <div>
              <div className="dx-card-title">Input</div>
              <div className="dx-card-hint">Run read-only checks or export a report.</div>
            </div>
          </div>

          <div className="dx-form">
            <div className="dx-field">
              <div className="dx-label">Connected address</div>
              <input value={address || ""} disabled />
            </div>

            <div className="dx-field" style={{ maxWidth: 380 }}>
              <div className="dx-label">Chain ID</div>
              <select
                value={selectedChainId}
                onChange={(e) => setChainInput(Number(e.target.value))}
                disabled={isConnected}
              >
                <option value={84532}>Base Sepolia (84532)</option>
                <option value={8453}>Base Mainnet (8453)</option>
              </select>
              <div className="dx-help">
                {isConnected ? "Locked while wallet is connected." : "Choose a chain for read-only checks."}
              </div>
            </div>

            {!isConnected ? (
              <div className="dx-field">
                <div className="dx-label">Read-only address</div>
                <input
                  placeholder="0x…"
                  value={addressInput}
                  onChange={(e) => setAddressInput(e.target.value)}
                />
              </div>
            ) : null}

            {error ? <div className="dx-alert dx-alert-danger">{error}</div> : null}

            <div className="dx-actions">
              <button className="dx-primary" onClick={runChecks} disabled={loading}>
                {loading ? "Running..." : "Run Checks"}
              </button>
              <button className="dx-miniBtn" onClick={handleExport} disabled={!results.length}>
                Export report
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Write Test */}
      <div className="dx-card">
        <div className="dx-card-in">
          <div className="dx-card-head">
            <div>
              <div className="dx-card-title">Write test</div>
              <div className="dx-card-hint">
                Cancel/Speed-up end-to-end on Base Sepolia. Sends 2 txs with small gas.
              </div>
            </div>
          </div>

          <div className="dx-form">
            <label className="dx-check">
              <input
                type="checkbox"
                checked={writeEnabled}
                onChange={(e) => {
                  setWriteEnabled(e.target.checked);
                  setWriteSteps([]);
                  setWriteError("");
                }}
                disabled={isDemo}
              />
              Enable write tests (Sepolia only)
            </label>

            <div className="dx-actions">
              <button
                className="dx-primary"
                onClick={() => setConfirmOpen(true)}
                disabled={isDemo || !writeEnabled || writeRunning || selectedChainId !== 84532}
              >
                {writeRunning ? "Running..." : "Run Cancel/Speed-up Test"}
              </button>
            </div>

            {selectedChainId !== 84532 ? (
              <div className="dx-alert dx-alert-warn">
                Switch to Base Sepolia (84532) to run write tests.
              </div>
            ) : null}

            {writeError ? <div className="dx-alert dx-alert-danger">{writeError}</div> : null}

            {writeSteps.length ? (
              <div className="dx-section">
                <div className="dx-card-title" style={{ marginBottom: 10 }}>
                  Progress
                </div>
                <div className="dx-form">
                  {writeSteps.map((step) => (
                    <div key={step.step} className="dx-alert">
                      <div className="dx-rowInline" style={{ justifyContent: "space-between" }}>
                        <div style={{ fontWeight: 800 }}>{step.step}</div>
                        <div className="dx-muted">{step.status}</div>
                      </div>
                      <div className="dx-subline">{step.details}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>

    {/* Results */}
    <div className="dx-card" style={{ marginTop: 14 }}>
      <div className="dx-card-in">
        <div className="dx-card-head">
          <div>
            <div className="dx-card-title">Results</div>
            <div className="dx-card-hint">PASS / WARN / FAIL summary + per-check details.</div>
          </div>

          <div className="dx-miniRow">
            <span className="dx-chip dx-chipOk">PASS: {totalSummary.PASS}</span>
            <span className="dx-chip dx-chipWarn">WARN: {totalSummary.WARN}</span>
            <span className="dx-chip dx-chipBad">FAIL: {totalSummary.FAIL}</span>
          </div>
        </div>

        <div className="dx-tableWrap">
          <div className="dx-tableScroll">
            <table className="dx-table">
              <thead>
                <tr>
                  <th className="dx-th">Check Name</th>
                  <th className="dx-th">Status</th>
                  <th className="dx-th">Details</th>
                  <th className="dx-th">Fix suggestion</th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 ? (
                  <tr>
                    <td className="dx-td dx-muted" colSpan={4}>
                      No checks run yet.
                    </td>
                  </tr>
                ) : (
                  results.map((row) => (
                    <tr key={`${row.name}-${row.durationMs}`} className="dx-row">
                      <td className="dx-td">{row.name}</td>
                      <td className="dx-td">
                        <span className="dx-pill" style={{ color: statusColor[row.status] }}>
                          {row.status}
                        </span>
                      </td>
                      <td className="dx-td">
                        {row.details} <span className="dx-muted">({formatMs(row.durationMs)})</span>
                      </td>
                      <td className="dx-td">{row.fix}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {lastRunRef.current ? (
          <div className="dx-muted" style={{ marginTop: 10 }}>
            Last run: <span className="dx-mono">{lastRunRef.current.address}</span> on{" "}
            <span className="dx-mono">{lastRunRef.current.chainId}</span>
          </div>
        ) : null}
      </div>
    </div>

    {/* Confirm modal */}
    {confirmOpen ? (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.65)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          padding: 14,
        }}
      >
        <div className="dx-card" style={{ width: "min(520px, 100%)" }}>
          <div className="dx-card-in">
            <div className="dx-card-head">
              <div>
                <div className="dx-card-title">Confirm write test</div>
                <div className="dx-card-hint">
                  This will send 2 transactions and spend a small amount of gas on Base Sepolia.
                </div>
              </div>
            </div>

            <div className="dx-actions" style={{ justifyContent: "flex-end" }}>
              <button className="dx-miniBtn" onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button
                className="dx-primary"
                onClick={async () => {
                  setConfirmOpen(false);
                  await runWriteTest();
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      </div>
    ) : null}
  </div>
);

}
