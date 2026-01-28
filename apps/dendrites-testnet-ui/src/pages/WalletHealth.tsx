import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { qpUrl } from "../lib/quickpayApiBase";
import { getQuickPayChainConfig } from "../lib/quickpayChainConfig";

export default function WalletHealth() {
  const { address, isConnected, chainId } = useAccount();
  const [activeTab, setActiveTab] = useState<"overview" | "approvals" | "activity" | "risk">("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nonceLatest, setNonceLatest] = useState<number | null>(null);
  const [noncePending, setNoncePending] = useState<number | null>(null);
  const [nativeBalance, setNativeBalance] = useState<string | null>(null);
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>({});
  const [tokenMeta, setTokenMeta] = useState<Record<string, { symbol: string; decimals: number }>>({});
  const [mdndxAddress, setMdndxAddress] = useState<string | null>(null);
  const [mdndxDecimals, setMdndxDecimals] = useState<number | null>(null);
  const [tokenAddress, setTokenAddress] = useState("");
  const [spenderMode, setSpenderMode] = useState<"permit2" | "router" | "custom">("permit2");
  const [customSpender, setCustomSpender] = useState("");
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [allowanceFormatted, setAllowanceFormatted] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState("");
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [tokenDetails, setTokenDetails] = useState<{ symbol: string; decimals: number } | null>(null);
  const [limitInput, setLimitInput] = useState("");
  const [txHash, setTxHash] = useState("");
  const [txStatus, setTxStatus] = useState("");
  const [lastCheckedToken, setLastCheckedToken] = useState("");
  const [lastCheckedSpender, setLastCheckedSpender] = useState("");
  const [lastAllowanceUnlimited, setLastAllowanceUnlimited] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [activityRows, setActivityRows] = useState<
    Array<{ address: string; count: number; lastSeen: number; hashes: string[]; isContract: boolean | null }>
  >([]);
  const [explorerBaseUrl, setExplorerBaseUrl] = useState("");
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [tagMap, setTagMap] = useState<Record<string, string>>({});
  const codeCacheRef = useRef<Map<string, boolean>>(new Map());

  const providerAvailable = Boolean((window as any)?.ethereum);
  const statusAddress = isConnected && address ? address : "Not connected";
  const networkLabel = chainId === 84532 ? "Base Sepolia" : chainId ? `Chain ${chainId}` : "Not available";
  const statusChain = chainId ? `${chainId} (${networkLabel})` : "Not available";
  const quickpayConfig = getQuickPayChainConfig(chainId ?? undefined);
  const quickpayRouter = quickpayConfig?.router;
  const permit2Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
  const approvalSpender = useMemo(() => {
    if (spenderMode === "permit2") return permit2Address;
    if (spenderMode === "router") return quickpayRouter || "";
    return customSpender.trim();
  }, [customSpender, permit2Address, quickpayRouter, spenderMode]);

  const loadMdndxConfig = useCallback(async () => {
    try {
      const res = await fetch(qpUrl("/faucet/config"));
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        return;
      }
      const addr = String(data?.mdndx?.address ?? "").trim();
      const decimals = Number(data?.mdndx?.decimals ?? NaN);
      if (addr && addr !== "<TODO_MDNDX_ADDRESS>") {
        setMdndxAddress(addr);
        if (!Number.isNaN(decimals)) {
          setMdndxDecimals(decimals);
        }
      } else {
        setMdndxAddress(null);
        setMdndxDecimals(null);
      }
    } catch {
      setMdndxAddress(null);
      setMdndxDecimals(null);
    }
  }, []);

  const loadOverview = useCallback(async () => {
    setError("");
    if (!address || !isConnected) {
      setNonceLatest(null);
      setNoncePending(null);
      setNativeBalance(null);
      setTokenBalances({});
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
      const [latest, pending, balance] = await Promise.all([
        provider.getTransactionCount(address, "latest"),
        provider.getTransactionCount(address, "pending"),
        provider.getBalance(address),
      ]);

      setNonceLatest(Number(latest));
      setNoncePending(Number(pending));
      setNativeBalance(ethers.formatEther(balance));

      const tokens: Array<{ address: string; symbol: string; decimals: number }> = [
        { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", symbol: "USDC", decimals: 6 },
      ];
      if (mdndxAddress) {
        tokens.push({
          address: mdndxAddress,
          symbol: "mDNDX",
          decimals: mdndxDecimals ?? 18,
        });
      }

      const erc20Abi = [
        "function balanceOf(address owner) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function symbol() view returns (string)",
      ];

      const metaUpdates: Record<string, { symbol: string; decimals: number }> = { ...tokenMeta };
      const balanceUpdates: Record<string, string> = {};

      await Promise.all(
        tokens.map(async (token) => {
          const contract = new ethers.Contract(token.address, erc20Abi, provider);
          let decimals = token.decimals;
          let symbol = token.symbol;

          const cached = metaUpdates[token.address];
          if (cached) {
            decimals = cached.decimals;
            symbol = cached.symbol;
          } else {
            try {
              const [decimalsOnChain, symbolOnChain] = await Promise.all([
                contract.decimals(),
                contract.symbol(),
              ]);
              decimals = Number(decimalsOnChain);
              symbol = String(symbolOnChain);
            } catch {
              decimals = token.decimals;
              symbol = token.symbol;
            }
            metaUpdates[token.address] = { symbol, decimals };
          }

          try {
            const bal = await contract.balanceOf(address);
            balanceUpdates[token.address] = ethers.formatUnits(bal, decimals);
          } catch {
            balanceUpdates[token.address] = "—";
          }
        })
      );

      setTokenMeta(metaUpdates);
      setTokenBalances(balanceUpdates);
    } catch (err: any) {
      setError(err?.message || "Failed to load wallet health.");
    } finally {
      setLoading(false);
    }
  }, [address, isConnected, mdndxAddress, mdndxDecimals, tokenMeta]);

  const loadActivity = useCallback(async () => {
    setActivityError("");
    if (!address || !isConnected) {
      setActivityRows([]);
      setExplorerBaseUrl("");
      return;
    }
    const ethereum = (window as any)?.ethereum;
    if (!ethereum) {
      setActivityError("Wallet provider not available.");
      return;
    }

    setActivityLoading(true);
    try {
      const url = qpUrl(`/wallet/activity/txlist?address=${address}&page=1&offset=50&sort=desc`);
      const res = await fetch(url);
      if (res.status === 429) {
        setActivityError("Rate limited, retry in a moment.");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        if (data?.error === "ACTIVITY_NOT_CONFIGURED") {
          setActivityError("Activity feed not configured (explorer API).");
          return;
        }
        if (data?.error === "RATE_LIMIT") {
          setActivityError("Rate limited, retry in a moment.");
          return;
        }
        setActivityError("Failed to load activity.");
        return;
      }

      const items = Array.isArray(data?.items) ? data.items : [];
      const grouped = new Map<string, { count: number; lastSeen: number; hashes: string[] }>();

      for (const item of items) {
        const to = String(item?.to || "").trim();
        if (!to || to === "null") continue;
        const ts = Number(item?.timeStamp || 0);
        const entry = grouped.get(to) ?? { count: 0, lastSeen: 0, hashes: [] };
        entry.count += 1;
        entry.lastSeen = Math.max(entry.lastSeen, ts || 0);
        if (entry.hashes.length < 5 && item?.hash) {
          entry.hashes.push(String(item.hash));
        }
        grouped.set(to, entry);
      }

      const provider = new ethers.BrowserProvider(ethereum);
      const rows: Array<{ address: string; count: number; lastSeen: number; hashes: string[]; isContract: boolean | null }> = [];

      await Promise.all(
        Array.from(grouped.entries()).map(async ([to, entry]) => {
          let isContract: boolean | null = null;
          if (codeCacheRef.current.has(to.toLowerCase())) {
            isContract = codeCacheRef.current.get(to.toLowerCase()) ?? null;
          } else {
            try {
              const code = await provider.getCode(to);
              isContract = code && code !== "0x";
              codeCacheRef.current.set(to.toLowerCase(), Boolean(isContract));
            } catch {
              isContract = null;
            }
          }
          rows.push({ address: to, ...entry, isContract });
        })
      );

      rows.sort((a, b) => b.lastSeen - a.lastSeen);

      const nextTagMap: Record<string, string> = { ...tagMap };
      for (const row of rows) {
        const key = `walletHealthTag:${chainId ?? "0"}:${row.address.toLowerCase()}`;
        if (nextTagMap[row.address] == null) {
          const stored = localStorage.getItem(key);
          if (stored != null) {
            nextTagMap[row.address] = stored;
          }
        }
      }

      setTagMap(nextTagMap);
      setExplorerBaseUrl(String(data?.explorerBaseUrl || ""));
      setActivityRows(rows);
    } catch (err: any) {
      setActivityError(err?.message || "Failed to load activity.");
    } finally {
      setActivityLoading(false);
    }
  }, [address, chainId, isConnected, tagMap]);

  const unknownContracts = useMemo(
    () => activityRows.filter((row) => !(tagMap[row.address] ?? "").trim()),
    [activityRows, tagMap]
  );

  const fetchTokenDetails = useCallback(
    async (provider: ethers.BrowserProvider, addr: string) => {
      const cached = tokenMeta[addr];
      if (cached) return cached;
      const erc20Abi = [
        "function decimals() view returns (uint8)",
        "function symbol() view returns (string)",
      ];
      const contract = new ethers.Contract(addr, erc20Abi, provider);
      const [decimalsOnChain, symbolOnChain] = await Promise.all([
        contract.decimals(),
        contract.symbol(),
      ]);
      const next = { decimals: Number(decimalsOnChain), symbol: String(symbolOnChain) };
      setTokenMeta((prev) => ({ ...prev, [addr]: next }));
      return next;
    },
    [tokenMeta]
  );

  const handleCheckAllowance = useCallback(async () => {
    setApprovalError("");
    setTxHash("");
    setTxStatus("");
    setAllowance(null);
    setAllowanceFormatted(null);
    setTokenDetails(null);

    if (!address || !isConnected) {
      setApprovalError("Connect your wallet first.");
      return;
    }
    const tokenAddr = tokenAddress.trim();
    const spenderAddr = approvalSpender.trim();
    if (!ethers.isAddress(tokenAddr)) {
      setApprovalError("Token address is invalid.");
      return;
    }
    if (!ethers.isAddress(spenderAddr)) {
      setApprovalError("Spender address is invalid.");
      return;
    }
    const ethereum = (window as any)?.ethereum;
    if (!ethereum) {
      setApprovalError("Wallet provider not available.");
      return;
    }

    setApprovalLoading(true);
    try {
      const provider = new ethers.BrowserProvider(ethereum);
      const erc20Abi = [
        "function allowance(address owner, address spender) view returns (uint256)",
      ];
      const contract = new ethers.Contract(tokenAddr, erc20Abi, provider);
      const meta = await fetchTokenDetails(provider, tokenAddr);
      const allowanceValue: bigint = await contract.allowance(address, spenderAddr);
      setTokenDetails(meta);
      setAllowance(allowanceValue);
      setAllowanceFormatted(ethers.formatUnits(allowanceValue, meta.decimals));
      setLastCheckedToken(tokenAddr);
      setLastCheckedSpender(spenderAddr);
      setLastAllowanceUnlimited(allowanceValue >= ethers.MaxUint256 / 2n);
    } catch (err: any) {
      setApprovalError(err?.message || "Failed to fetch allowance.");
      setLastCheckedToken("");
      setLastCheckedSpender("");
      setLastAllowanceUnlimited(false);
    } finally {
      setApprovalLoading(false);
    }
  }, [address, approvalSpender, fetchTokenDetails, isConnected, tokenAddress]);

  const handleApprove = useCallback(
    async (value: bigint) => {
      setApprovalError("");
      setTxHash("");
      setTxStatus("");
      if (!address || !isConnected) {
        setApprovalError("Connect your wallet first.");
        return;
      }
      const tokenAddr = tokenAddress.trim();
      const spenderAddr = approvalSpender.trim();
      if (!ethers.isAddress(tokenAddr)) {
        setApprovalError("Token address is invalid.");
        return;
      }
      if (!ethers.isAddress(spenderAddr)) {
        setApprovalError("Spender address is invalid.");
        return;
      }
      const ethereum = (window as any)?.ethereum;
      if (!ethereum) {
        setApprovalError("Wallet provider not available.");
        return;
      }
      setApprovalLoading(true);
      try {
        const provider = new ethers.BrowserProvider(ethereum);
        const signer = await provider.getSigner();
        const erc20Abi = [
          "function approve(address spender, uint256 value) returns (bool)",
        ];
        const contract = new ethers.Contract(tokenAddr, erc20Abi, signer);
        setTxStatus("Submitting...");
        const tx = await contract.approve(spenderAddr, value);
        setTxHash(tx?.hash ?? "");
        setTxStatus("Pending...");
        await tx.wait();
        setTxStatus("Confirmed");
        await handleCheckAllowance();
      } catch (err: any) {
        setTxStatus("");
        setApprovalError(err?.message || "Approval failed.");
      } finally {
        setApprovalLoading(false);
      }
    },
    [address, approvalSpender, handleCheckAllowance, isConnected, tokenAddress]
  );

  useEffect(() => {
    if (activeTab !== "overview") return;
    const run = async () => {
      await loadMdndxConfig();
      await loadOverview();
    };
    run();
  }, [activeTab, loadMdndxConfig, loadOverview]);

  useEffect(() => {
    if (activeTab !== "activity") return;
    loadActivity();
  }, [activeTab, loadActivity]);

  useEffect(() => {
    if (activeTab !== "risk") return;
    if (activityRows.length === 0) {
      loadActivity();
    }
  }, [activeTab, activityRows.length, loadActivity]);

  const jumpToApprovals = useCallback(
    (tokenAddr: string, spenderAddr: string) => {
      setTokenAddress(tokenAddr);
      if (spenderAddr.toLowerCase() === permit2Address.toLowerCase()) {
        setSpenderMode("permit2");
        setCustomSpender("");
      } else if (quickpayRouter && spenderAddr.toLowerCase() === quickpayRouter.toLowerCase()) {
        setSpenderMode("router");
        setCustomSpender("");
      } else {
        setSpenderMode("custom");
        setCustomSpender(spenderAddr);
      }
      setActiveTab("approvals");
    },
    [permit2Address, quickpayRouter]
  );

  const tabButtonStyle = useMemo(
    () =>
      (isActive: boolean) => ({
        padding: "6px 10px",
        borderRadius: 6,
        border: "1px solid #2a2a2a",
        background: isActive ? "#1f1f1f" : "transparent",
        color: isActive ? "#ffffff" : "#cfcfcf",
        cursor: "pointer",
      }),
    []
  );

  const tabLinkStyle = {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid #2a2a2a",
    color: "#cfcfcf",
    textDecoration: "none",
  } as const;

  return (
    <div style={{ padding: 16 }}>
      <h2>Wallet Health Console</h2>
      <div style={{ color: "#bdbdbd", marginTop: 6 }}>
        Quick snapshot of wallet status and basic risk signals.
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button style={tabButtonStyle(activeTab === "overview")} onClick={() => setActiveTab("overview")}>
          Overview
        </button>
        <button style={tabButtonStyle(activeTab === "approvals")} onClick={() => setActiveTab("approvals")}>
          Approvals
        </button>
        <button style={tabButtonStyle(activeTab === "activity")} onClick={() => setActiveTab("activity")}>
          Activity
        </button>
        <button style={tabButtonStyle(activeTab === "risk")} onClick={() => setActiveTab("risk")}>
          Risk
        </button>
        <Link to="/nonce-rescue" style={tabLinkStyle}>
          Nonce Rescue
        </Link>
      </div>

      {activeTab === "overview" ? (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 720 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Connection</div>
          <div><strong>Connected Address:</strong> {statusAddress}</div>
          <div><strong>Chain ID:</strong> {statusChain}</div>
          <div><strong>Provider:</strong> {providerAvailable ? "Detected" : "Not available"}</div>
          <div><strong>Nonce (latest):</strong> {nonceLatest ?? "—"}</div>
          <div><strong>Nonce (pending):</strong> {noncePending ?? "—"}</div>
          <div><strong>Native Balance (ETH):</strong> {nativeBalance ?? "—"}</div>
          <div style={{ marginTop: 8, fontWeight: 600 }}>Token Balances</div>
          <div style={{ color: "#bdbdbd" }}>
            <div>USDC: {tokenBalances["0x036CbD53842c5426634e7929541eC2318f3dCF7e"] ?? "—"}</div>
            {mdndxAddress ? (
              <div>{tokenMeta[mdndxAddress]?.symbol || "mDNDX"}: {tokenBalances[mdndxAddress] ?? "—"}</div>
            ) : null}
          </div>
          {error ? <div style={{ color: "#ff7a7a", marginTop: 8 }}>{error}</div> : null}
          <div style={{ marginTop: 10 }}>
            <button
              onClick={async () => {
                await loadMdndxConfig();
                await loadOverview();
              }}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <div style={{ color: "#bdbdbd", marginTop: 8 }}>
            Signer and provider actions are handled via the existing wallet connection.
          </div>
        </div>
      ) : null}

      {activeTab === "approvals" ? (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 720 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Token Approvals</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label>
              <div style={{ marginBottom: 4 }}>Token address</div>
              <input
                style={{ width: "100%", padding: 8 }}
                placeholder="0x… token"
                value={tokenAddress}
                onChange={(e) => setTokenAddress(e.target.value)}
              />
            </label>
            <label>
              <div style={{ marginBottom: 4 }}>Spender</div>
              <select
                style={{ width: "100%", maxWidth: 320, padding: 8 }}
                value={spenderMode}
                onChange={(e) => setSpenderMode(e.target.value as "permit2" | "router" | "custom")}
              >
                <option value="permit2">Permit2</option>
                {quickpayRouter ? <option value="router">QuickPay Router</option> : null}
                <option value="custom">Custom</option>
              </select>
            </label>
            {spenderMode === "custom" ? (
              <label>
                <div style={{ marginBottom: 4 }}>Custom spender address</div>
                <input
                  style={{ width: "100%", padding: 8 }}
                  placeholder="0x… spender"
                  value={customSpender}
                  onChange={(e) => setCustomSpender(e.target.value)}
                />
              </label>
            ) : null}
            <div>
              <button onClick={handleCheckAllowance} disabled={approvalLoading}>
                {approvalLoading ? "Checking..." : "Check Allowance"}
              </button>
            </div>
          </div>

          {tokenDetails ? (
            <div style={{ marginTop: 12, color: "#d6d6d6" }}>
              <div><strong>Token:</strong> {tokenDetails.symbol} (decimals: {tokenDetails.decimals})</div>
              <div>
                <strong>Allowance:</strong> {allowanceFormatted ?? "—"}
              </div>
              {allowance != null && allowance >= ethers.MaxUint256 / 2n ? (
                <div style={{ marginTop: 6, color: "#ffb74d" }}>
                  Warning: allowance is effectively unlimited.
                </div>
              ) : null}
            </div>
          ) : null}

          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => handleApprove(0n)}
              disabled={approvalLoading}
            >
              Revoke
            </button>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              style={{ width: "100%", maxWidth: 220, padding: 8 }}
              placeholder="Set limit"
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
            />
            <button
              onClick={async () => {
                setApprovalError("");
                if (!limitInput.trim()) {
                  setApprovalError("Enter a limit value.");
                  return;
                }
                const tokenAddr = tokenAddress.trim();
                if (!ethers.isAddress(tokenAddr)) {
                  setApprovalError("Token address is invalid.");
                  return;
                }
                const ethereum = (window as any)?.ethereum;
                if (!ethereum) {
                  setApprovalError("Wallet provider not available.");
                  return;
                }
                try {
                  const provider = new ethers.BrowserProvider(ethereum);
                  const meta = tokenDetails ?? (await fetchTokenDetails(provider, tokenAddr));
                  const amount = ethers.parseUnits(limitInput, meta.decimals);
                  await handleApprove(amount);
                } catch (err: any) {
                  setApprovalError(err?.message || "Invalid limit.");
                }
              }}
              disabled={approvalLoading}
            >
              Set Limit
            </button>
          </div>

          {txHash ? (
            <div style={{ marginTop: 8, color: "#bdbdbd" }}>
              <div><strong>Tx Hash:</strong> {txHash}</div>
              {txStatus ? <div><strong>Status:</strong> {txStatus}</div> : null}
            </div>
          ) : null}
          {approvalError ? <div style={{ color: "#ff7a7a", marginTop: 8 }}>{approvalError}</div> : null}
        </div>
      ) : null}

      {activeTab === "activity" ? (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 720 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Recent Activity</div>
          <div style={{ color: "#bdbdbd", marginBottom: 8 }}>
            Contracts interacted recently (grouped by recipient address).
          </div>
          <div style={{ marginBottom: 10 }}>
            <button onClick={loadActivity} disabled={activityLoading}>
              {activityLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          {activityError ? <div style={{ color: "#ffb74d", marginTop: 6 }}>{activityError}</div> : null}
          {!activityError && activityRows.length === 0 ? (
            <div style={{ color: "#bdbdbd" }}>No activity found.</div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {activityRows.map((row) => {
              const lastSeenLabel = row.lastSeen
                ? new Date(row.lastSeen * 1000).toLocaleString()
                : "—";
              const tagKey = `walletHealthTag:${chainId ?? "0"}:${row.address.toLowerCase()}`;
              return (
                <div key={row.address} style={{ padding: 10, border: "1px solid #2a2a2a", borderRadius: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div>
                      <div><strong>Address:</strong> {row.address}</div>
                      <div><strong>Type:</strong> {row.isContract === null ? "Unknown" : row.isContract ? "Contract" : "EOA"}</div>
                      <div><strong>Count:</strong> {row.count}</div>
                      <div><strong>Last Seen:</strong> {lastSeenLabel}</div>
                    </div>
                    <div style={{ minWidth: 200 }}>
                      <div style={{ marginBottom: 4 }}>Tag</div>
                      <input
                        style={{ width: "100%", padding: 6 }}
                        placeholder="Add tag"
                        value={tagMap[row.address] ?? ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          setTagMap((prev) => ({ ...prev, [row.address]: value }));
                          localStorage.setItem(tagKey, value);
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <button
                      onClick={() =>
                        setExpandedRows((prev) => ({ ...prev, [row.address]: !prev[row.address] }))
                      }
                    >
                      {expandedRows[row.address] ? "Hide" : "Show"} last 5 txs
                    </button>
                  </div>
                  {expandedRows[row.address] ? (
                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                      {row.hashes.map((hash) => (
                        <a
                          key={hash}
                          href={explorerBaseUrl ? `${explorerBaseUrl}/tx/${hash}` : undefined}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#90caf9" }}
                        >
                          {hash}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeTab === "risk" ? (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 720 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Risk Signals</div>
          <div style={{ color: "#bdbdbd", marginBottom: 10 }}>Signals, not guarantees.</div>

          <div style={{ marginTop: 8, padding: 10, border: "1px solid #2a2a2a", borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Pending nonce risk</div>
            {nonceLatest != null && noncePending != null && noncePending > nonceLatest ? (
              <div style={{ color: "#ffb74d" }}>
                Pending nonce is higher than latest. You may have a stuck transaction. <Link to="/nonce-rescue">Open Nonce Rescue</Link>
              </div>
            ) : (
              <div style={{ color: "#bdbdbd" }}>No pending nonce risk detected.</div>
            )}
          </div>

          <div style={{ marginTop: 12, padding: 10, border: "1px solid #2a2a2a", borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>High-risk approvals</div>
            {lastAllowanceUnlimited && lastCheckedToken && lastCheckedSpender ? (
              <div>
                <div style={{ color: "#ffb74d", marginBottom: 6 }}>
                  Unlimited allowance detected for the last checked token/spender.
                </div>
                <button onClick={() => jumpToApprovals(lastCheckedToken, lastCheckedSpender)}>
                  Review in Approvals
                </button>
              </div>
            ) : (
              <div style={{ color: "#bdbdbd" }}>No unlimited allowance detected from the last check.</div>
            )}
          </div>

          <div style={{ marginTop: 12, padding: 10, border: "1px solid #2a2a2a", borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Unknown contracts interacted</div>
            {unknownContracts.length === 0 ? (
              <div style={{ color: "#bdbdbd" }}>No unknown contracts found.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {unknownContracts.map((row) => {
                  const key = `walletHealthTag:${chainId ?? "0"}:${row.address.toLowerCase()}`;
                  return (
                    <div key={row.address} style={{ padding: 8, border: "1px solid #2a2a2a", borderRadius: 8 }}>
                      <div><strong>Address:</strong> {row.address}</div>
                      <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input
                          style={{ width: "100%", maxWidth: 260, padding: 6 }}
                          placeholder="Tag it"
                          value={tagMap[row.address] ?? ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            setTagMap((prev) => ({ ...prev, [row.address]: value }));
                            localStorage.setItem(key, value);
                          }}
                        />
                        <a
                          href={explorerBaseUrl ? `${explorerBaseUrl}/address/${row.address}` : undefined}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#90caf9", alignSelf: "center" }}
                        >
                          Open in explorer
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
