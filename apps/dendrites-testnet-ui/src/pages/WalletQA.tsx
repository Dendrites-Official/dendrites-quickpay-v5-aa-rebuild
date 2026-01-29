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
    </div>
  );
}
