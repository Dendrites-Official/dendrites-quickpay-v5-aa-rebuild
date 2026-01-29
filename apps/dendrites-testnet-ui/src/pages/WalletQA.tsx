import { useCallback, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { qpUrl } from "../lib/quickpayApiBase";

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
  const { address, isConnected, chainId } = useAccount();
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
  }, [address, chainId, isConnected, selectedAddress, selectedChainId]);

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
  }, [address, isConnected, selectedChainId, updateWriteStep, writeEnabled]);

  return (
    <div style={{ padding: 16 }}>
      <h2>Wallet QA Harness</h2>
      <div style={{ color: "#bdbdbd", marginTop: 6 }}>
        Internal checks for Wallet Health, Activity, Approvals, Risk, Tx Queue, and Nonce Rescue.
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 820 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Input</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label>
            <div style={{ marginBottom: 4 }}>Connected address</div>
            <input style={{ width: "100%", padding: 8 }} value={address || ""} disabled />
          </label>
          <label>
            <div style={{ marginBottom: 4 }}>Chain ID</div>
            <select
              style={{ width: 240, padding: 8 }}
              value={selectedChainId}
              onChange={(e) => setChainInput(Number(e.target.value))}
              disabled={isConnected}
            >
              <option value={84532}>Base Sepolia (84532)</option>
              <option value={8453}>Base Mainnet (8453)</option>
            </select>
          </label>
          {!isConnected ? (
            <label>
              <div style={{ marginBottom: 4 }}>Read-only address</div>
              <input
                style={{ width: "100%", padding: 8 }}
                placeholder="0x…"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
              />
            </label>
          ) : null}
          {error ? <div style={{ color: "#ff6b6b" }}>{error}</div> : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={runChecks} disabled={loading}>
              {loading ? "Running..." : "Run Checks"}
            </button>
            <button onClick={handleExport} disabled={!results.length}>
              Export report
            </button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 820 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Write Test: Cancel/Speed-up</div>
        <div style={{ color: "#bdbdbd", marginBottom: 8 }}>
          Runs an end-to-end nonce replacement on Base Sepolia. Sends 2 transactions and uses small gas.
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={writeEnabled}
            onChange={(e) => {
              setWriteEnabled(e.target.checked);
              setWriteSteps([]);
              setWriteError("");
            }}
          />
          Enable write tests (Sepolia only)
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={!writeEnabled || writeRunning || selectedChainId !== 84532}
          >
            {writeRunning ? "Running..." : "Run Cancel/Speed-up Test"}
          </button>
          {selectedChainId !== 84532 ? (
            <div style={{ color: "#ffb74d" }}>Switch to Base Sepolia (84532) to run write tests.</div>
          ) : null}
        </div>
        {writeError ? <div style={{ color: "#ff6b6b", marginTop: 8 }}>{writeError}</div> : null}
        {writeSteps.length ? (
          <div style={{ marginTop: 10, color: "#d6d6d6" }}>
            {writeSteps.map((step) => (
              <div key={step.step} style={{ marginBottom: 6 }}>
                <strong>{step.step}:</strong> {step.status} — {step.details}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Results</div>
        <div style={{ marginBottom: 8, color: "#cfcfcf" }}>
          PASS: {totalSummary.PASS} | WARN: {totalSummary.WARN} | FAIL: {totalSummary.FAIL}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #2a2a2a" }}>Check Name</th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #2a2a2a" }}>Status</th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #2a2a2a" }}>Details</th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #2a2a2a" }}>Fix suggestion</th>
              </tr>
            </thead>
            <tbody>
              {results.length === 0 ? (
                <tr>
                  <td style={{ padding: 8, color: "#888" }} colSpan={4}>
                    No checks run yet.
                  </td>
                </tr>
              ) : (
                results.map((row) => (
                  <tr key={`${row.name}-${row.durationMs}`}>
                    <td style={{ padding: 8, borderBottom: "1px solid #1f1f1f" }}>{row.name}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #1f1f1f", color: statusColor[row.status] }}>
                      {row.status}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #1f1f1f" }}>
                      {row.details} ({formatMs(row.durationMs)})
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #1f1f1f" }}>{row.fix}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {lastRunRef.current ? (
          <div style={{ marginTop: 10, color: "#9e9e9e" }}>
            Last run: {lastRunRef.current.address} on {lastRunRef.current.chainId}
          </div>
        ) : null}
      </div>

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
          }}
        >
          <div style={{ background: "#151515", border: "1px solid #2a2a2a", borderRadius: 10, padding: 16, maxWidth: 420 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Confirm write test</div>
            <div style={{ color: "#d6d6d6", marginBottom: 12 }}>
              This will send 2 transactions and spend a small amount of gas on Base Sepolia.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmOpen(false)}>Cancel</button>
              <button
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
      ) : null}
    </div>
  );
}
