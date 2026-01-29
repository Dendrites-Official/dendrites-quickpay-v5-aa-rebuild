import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { qpUrl } from "../lib/quickpayApiBase";
import { getQuickPayChainConfig } from "../lib/quickpayChainConfig";
import { logEvent } from "../lib/analytics";
import MainnetConfirmModal from "../components/MainnetConfirmModal";
import { estimateTxCost } from "../lib/txEstimate";
import { normalizeWalletError } from "../lib/walletErrors";

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
  const [approvalErrorDetails, setApprovalErrorDetails] = useState<string | null>(null);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [tokenDetails, setTokenDetails] = useState<{ symbol: string; decimals: number } | null>(null);
  const [limitInput, setLimitInput] = useState("");
  const [txHash, setTxHash] = useState("");
  const [txStatus, setTxStatus] = useState("");
  const [lastCheckedToken, setLastCheckedToken] = useState("");
  const [lastCheckedSpender, setLastCheckedSpender] = useState("");
  const [lastAllowanceUnlimited, setLastAllowanceUnlimited] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [scanError, setScanError] = useState("");
  const [scanResults, setScanResults] = useState<
    Array<{
      tokenAddress: string;
      symbol: string | null;
      decimals: number | null;
      allowances: Array<{ spender: string; allowance: string; isUnlimited: boolean; error?: string }>;
      error?: string | null;
    }>
  >([]);
  const [scanLimitInputs, setScanLimitInputs] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmSummary, setConfirmSummary] = useState("");
  const [confirmGasEstimate, setConfirmGasEstimate] = useState<string | null>(null);
  const [confirmGasError, setConfirmGasError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<null | (() => Promise<void>)>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [activityRows, setActivityRows] = useState<
    Array<{ address: string; count: number; lastSeen: number; hashes: string[]; isContract: boolean | null }>
  >([]);
  const [explorerBaseUrl, setExplorerBaseUrl] = useState("");
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [tagMap, setTagMap] = useState<Record<string, string>>({});
  const codeCacheRef = useRef<Map<string, boolean>>(new Map());
  const tokenMetaRef = useRef<Record<string, { symbol: string; decimals: number }>>({});
  const tagMapRef = useRef<Record<string, string>>({});
  const loggedOpenRef = useRef(false);

  const providerAvailable = Boolean((window as any)?.ethereum);
  const statusAddress = isConnected && address ? address : "Not connected";
  const networkLabel = chainId === 84532 ? "Base Sepolia" : chainId ? `Chain ${chainId}` : "Not available";
  const statusChain = chainId ? `${chainId} (${networkLabel})` : "Not available";
  const quickpayConfig = getQuickPayChainConfig(chainId ?? undefined);
  const quickpayRouter = quickpayConfig?.router;
  const permit2Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
  const quickpayPaymaster = String(
    (import.meta as any)?.env?.VITE_PAYMASTER_ADDRESS ??
      (import.meta as any)?.env?.VITE_PAYMASTER ??
      ""
  ).trim();

  const knownLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    if (permit2Address) labels[permit2Address.toLowerCase()] = "Permit2";
    if (quickpayRouter) labels[quickpayRouter.toLowerCase()] = "QuickPay Router";
    if (quickpayPaymaster) labels[quickpayPaymaster.toLowerCase()] = "QuickPay Paymaster";
    if (quickpayConfig?.feeVault) labels[quickpayConfig.feeVault.toLowerCase()] = "FeeVault";
    return labels;
  }, [permit2Address, quickpayConfig?.feeVault, quickpayPaymaster, quickpayRouter]);
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

  useEffect(() => {
    if (loggedOpenRef.current) return;
    loggedOpenRef.current = true;
    void logEvent("wallet_health_open", { tab: "overview" }, address ?? null, chainId ?? null);
  }, [address, chainId]);

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

      const metaUpdates: Record<string, { symbol: string; decimals: number }> = { ...tokenMetaRef.current };
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

      tokenMetaRef.current = metaUpdates;
      setTokenMeta(metaUpdates);
      setTokenBalances(balanceUpdates);
    } catch (err: any) {
      setError(err?.message || "Failed to load wallet health.");
    } finally {
      setLoading(false);
    }
  }, [address, isConnected, mdndxAddress, mdndxDecimals]);

  useEffect(() => {
    tokenMetaRef.current = tokenMeta;
  }, [tokenMeta]);

  useEffect(() => {
    tagMapRef.current = tagMap;
  }, [tagMap]);

  const loadActivity = useCallback(async () => {
    setActivityError("");
    if (!address || !isConnected) {
      setActivityRows([]);
      setExplorerBaseUrl("");
      return;
    }
    if (chainId !== 8453 && chainId !== 84532) {
      setActivityRows([]);
      setExplorerBaseUrl("");
      setActivityError("Unsupported chain for Activity/TxQueue.");
      return;
    }
    const ethereum = (window as any)?.ethereum;
    if (!ethereum) {
      setActivityError("Wallet provider not available.");
      return;
    }

    setActivityLoading(true);
    try {
      const url = qpUrl(
        `/wallet/activity/txlist?address=${address}&chainId=${chainId}&page=1&offset=50&sort=desc`
      );
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
        if (data?.error === "ACTIVITY_UNSUPPORTED_CHAIN") {
          setActivityError("Unsupported chain for Activity/TxQueue.");
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

      const nextTagMap: Record<string, string> = { ...tagMapRef.current };
      for (const row of rows) {
        const key = `walletHealthTag:${chainId ?? "0"}:${row.address.toLowerCase()}`;
        if (nextTagMap[row.address] == null) {
          const stored = localStorage.getItem(key);
          if (stored != null) {
            nextTagMap[row.address] = stored;
          }
        }
      }

      const tagsChanged = Object.keys(nextTagMap).some(
        (key) => nextTagMap[key] !== tagMapRef.current[key]
      );
      if (tagsChanged) {
        setTagMap(nextTagMap);
      }
      setExplorerBaseUrl(String(data?.explorerBaseUrl || ""));
      setActivityRows(rows);
    } catch (err: any) {
      setActivityError(err?.message || "Failed to load activity.");
    } finally {
      setActivityLoading(false);
    }
  }, [address, chainId, isConnected]);

  const unknownContracts = useMemo(
    () =>
      activityRows.filter((row) => {
        const userTag = (tagMap[row.address] ?? "").trim();
        const known = knownLabels[row.address.toLowerCase()];
        return !userTag && !known;
      }),
    [activityRows, knownLabels, tagMap]
  );

  const unlimitedApprovals = useMemo(() => {
    const rows: Array<{ tokenAddress: string; symbol: string | null; spender: string }> = [];
    for (const token of scanResults) {
      if (!token?.allowances || token?.error) continue;
      for (const allowance of token.allowances) {
        if (allowance?.isUnlimited) {
          rows.push({
            tokenAddress: token.tokenAddress,
            symbol: token.symbol ?? null,
            spender: allowance.spender,
          });
        }
      }
    }
    return rows;
  }, [scanResults]);

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
    setApprovalErrorDetails(null);
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
    void logEvent(
      "approvals_check",
      { token: tokenAddr, spender: spenderAddr },
      address ?? null,
      chainId ?? null
    );
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
  }, [address, approvalSpender, chainId, fetchTokenDetails, isConnected, tokenAddress]);

  const withMainnetConfirm = useCallback(
    async (summary: string, txRequest: ethers.TransactionRequest, action: () => Promise<void>) => {
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
        setTxStatus(`Estimated gas: ${estimate.costEth}`);
      } else if (estimate.error) {
        setTxStatus("Unable to estimate; wallet will show final gas.");
      }
      await action();
    },
    [chainId]
  );

  const handleApprove = useCallback(
    async (value: bigint) => {
      setApprovalError("");
      setApprovalErrorDetails(null);
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
      const eventKind = value === 0n ? "approvals_revoke" : "approvals_set_limit";
      void logEvent(
        eventKind,
        { token: tokenAddr, spender: spenderAddr, value: value.toString() },
        address ?? null,
        chainId ?? null
      );
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
        const txRequest = await contract.approve.populateTransaction(spenderAddr, value);
        const requestWithFrom = { ...txRequest, from: address } as ethers.TransactionRequest;
        const summary = `${value === 0n ? "Revoke" : "Set limit"} ${tokenAddr} → ${spenderAddr}`;
        await withMainnetConfirm(summary, requestWithFrom, async () => {
          setTxStatus("Submitting...");
          try {
            const tx = await signer.sendTransaction(requestWithFrom);
            setTxHash(tx?.hash ?? "");
            setTxStatus("Pending...");
            await tx.wait();
            setTxStatus("Confirmed");
            await handleCheckAllowance();
          } catch (err: any) {
            const normalized = normalizeWalletError(err);
            setTxStatus("");
            setApprovalError(normalized.message);
            setApprovalErrorDetails(normalized.details);
          }
        });
      } catch (err: any) {
        setTxStatus("");
        const normalized = normalizeWalletError(err);
        setApprovalError(normalized.message);
        setApprovalErrorDetails(normalized.details);
      } finally {
        setApprovalLoading(false);
      }
    },
    [address, approvalSpender, chainId, handleCheckAllowance, isConnected, tokenAddress, withMainnetConfirm]
  );

  const handleApproveFor = useCallback(
    async (tokenAddr: string, spenderAddr: string, value: bigint) => {
      setApprovalError("");
      setApprovalErrorDetails(null);
      setTxHash("");
      setTxStatus("");
      if (!address || !isConnected) {
        setApprovalError("Connect your wallet first.");
        return;
      }
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
        const erc20Abi = ["function approve(address spender, uint256 value) returns (bool)"];
        const contract = new ethers.Contract(tokenAddr, erc20Abi, signer);
        const txRequest = await contract.approve.populateTransaction(spenderAddr, value);
        const requestWithFrom = { ...txRequest, from: address } as ethers.TransactionRequest;
        const summary = `${value === 0n ? "Revoke" : "Set limit"} ${tokenAddr} → ${spenderAddr}`;
        await withMainnetConfirm(summary, requestWithFrom, async () => {
          setTxStatus("Submitting...");
          try {
            const tx = await signer.sendTransaction(requestWithFrom);
            setTxHash(tx?.hash ?? "");
            setTxStatus("Pending...");
            await tx.wait();
            setTxStatus("Confirmed");
          } catch (err: any) {
            const normalized = normalizeWalletError(err);
            setTxStatus("");
            setApprovalError(normalized.message);
            setApprovalErrorDetails(normalized.details);
          }
        });
      } catch (err: any) {
        setTxStatus("");
        const normalized = normalizeWalletError(err);
        setApprovalError(normalized.message);
        setApprovalErrorDetails(normalized.details);
      } finally {
        setApprovalLoading(false);
      }
    },
    [address, isConnected, withMainnetConfirm]
  );

  const handleScanApprovals = useCallback(async () => {
    setScanError("");
    setScanResults([]);
    setScanProgress({ done: 0, total: 0 });
    if (!address || !isConnected) {
      setScanError("Connect your wallet first.");
      return;
    }
    if (chainId !== 8453 && chainId !== 84532) {
      setScanError("Unsupported chain for Approvals Scan.");
      return;
    }
    setScanLoading(true);
    try {
      const res = await fetch(qpUrl("/wallet/approvals/scan"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId, owner: address }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setScanError(data?.error || "Scan failed.");
        return;
      }
      const tokens = Array.isArray(data?.tokens) ? data.tokens : [];
      setScanResults(tokens);
      setScanProgress({ done: tokens.length, total: tokens.length });
    } catch (err: any) {
      setScanError(err?.message || "Scan failed.");
    } finally {
      setScanLoading(false);
    }
  }, [address, chainId, isConnected]);

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

      <div style={{ marginTop: 12, padding: 12, border: "1px solid #2a2a2a", borderRadius: 8, maxWidth: 720 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Investor Snapshot</div>
        <div><strong>Chain:</strong> {statusChain}</div>
        <div>
          <strong>Pending txs:</strong> {nonceLatest != null && noncePending != null && noncePending > nonceLatest ? "Yes" : "No"}
        </div>
        <div><strong>Unlimited approvals:</strong> {unlimitedApprovals.length}</div>
        <div><strong>Unknown contracts interacted:</strong> {unknownContracts.length}</div>
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link to="/tx-queue" style={tabLinkStyle}>View Tx Queue</Link>
          <button onClick={handleScanApprovals} disabled={scanLoading}>Scan Approvals</button>
          <button onClick={() => setActiveTab("activity")}>Open Activity</button>
        </div>
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
        <Link to="/tx-queue" style={tabLinkStyle}>
          Tx Queue
        </Link>
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
          <div style={{ marginTop: 8, marginBottom: 12, padding: 10, border: "1px solid #2a2a2a", borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Approvals Scanner (v2)</div>
            <div style={{ color: "#bdbdbd", marginBottom: 8 }}>
              Scan tokens the wallet touched and check allowances for default spenders.
            </div>
            <button onClick={handleScanApprovals} disabled={scanLoading}>
              {scanLoading ? "Scanning..." : "Scan approvals"}
            </button>
            {scanLoading ? (
              <div style={{ color: "#bdbdbd", marginTop: 8 }}>
                Scanning tokens... {scanProgress.done}/{scanProgress.total || "?"}
              </div>
            ) : null}
            {scanError ? <div style={{ color: "#ff7a7a", marginTop: 8 }}>{scanError}</div> : null}
            {scanResults.length ? (
              <div style={{ marginTop: 12, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left" }}>
                      <th style={{ padding: "6px", borderBottom: "1px solid #333" }}>Token</th>
                      <th style={{ padding: "6px", borderBottom: "1px solid #333" }}>Spender</th>
                      <th style={{ padding: "6px", borderBottom: "1px solid #333" }}>Allowance</th>
                      <th style={{ padding: "6px", borderBottom: "1px solid #333" }}>Risk</th>
                      <th style={{ padding: "6px", borderBottom: "1px solid #333" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanResults.map((token) => {
                      const tokenLabel = token.symbol ? `${token.symbol} (${token.tokenAddress})` : token.tokenAddress;
                      if (token.error) {
                        return (
                          <tr key={token.tokenAddress}>
                            <td style={{ padding: "6px" }} colSpan={5}>
                              {tokenLabel}: {token.error}
                            </td>
                          </tr>
                        );
                      }
                      return token.allowances.map((allowance, idx) => {
                        const key = `${token.tokenAddress}:${allowance.spender}:${idx}`;
                        const inputKey = `${token.tokenAddress}:${allowance.spender}`;
                        const limitValue = scanLimitInputs[inputKey] ?? "";
                        return (
                          <tr key={key}>
                            <td style={{ padding: "6px" }}>{tokenLabel}</td>
                            <td style={{ padding: "6px" }}>{allowance.spender}</td>
                            <td style={{ padding: "6px" }}>{allowance.allowance}</td>
                            <td style={{ padding: "6px", color: allowance.isUnlimited ? "#ffb74d" : "#bdbdbd" }}>
                              {allowance.isUnlimited ? "Unlimited" : "OK"}
                            </td>
                            <td style={{ padding: "6px" }}>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                <button
                                  onClick={() => handleApproveFor(token.tokenAddress, allowance.spender, 0n)}
                                  disabled={approvalLoading}
                                >
                                  Revoke
                                </button>
                                <input
                                  style={{ width: 120, padding: 6 }}
                                  placeholder="Set limit"
                                  value={limitValue}
                                  onChange={(e) =>
                                    setScanLimitInputs((prev) => ({ ...prev, [inputKey]: e.target.value }))
                                  }
                                />
                                <button
                                  onClick={async () => {
                                    const raw = (scanLimitInputs[inputKey] ?? "").trim();
                                    if (!raw) {
                                      setApprovalError("Enter a limit value.");
                                      return;
                                    }
                                    try {
                                      const decimals = token.decimals ?? 18;
                                      const amount = ethers.parseUnits(raw, decimals);
                                      await handleApproveFor(token.tokenAddress, allowance.spender, amount);
                                    } catch (err: any) {
                                      setApprovalError(err?.message || "Invalid limit.");
                                    }
                                  }}
                                  disabled={approvalLoading}
                                >
                                  Set limit
                                </button>
                              </div>
                              {allowance.error ? (
                                <div style={{ color: "#ff7a7a", marginTop: 4 }}>{allowance.error}</div>
                              ) : null}
                            </td>
                          </tr>
                        );
                      });
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
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
          {approvalError ? (
            <div style={{ color: "#ff7a7a", marginTop: 8 }}>
              {approvalError}
              {approvalErrorDetails ? (
                <details style={{ marginTop: 6, color: "#bdbdbd" }}>
                  <summary style={{ cursor: "pointer" }}>Technical details</summary>
                  <div style={{ marginTop: 4 }}>{approvalErrorDetails}</div>
                </details>
              ) : null}
            </div>
          ) : null}
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
              const knownLabel = knownLabels[row.address.toLowerCase()];
              const tagKey = `walletHealthTag:${chainId ?? "0"}:${row.address.toLowerCase()}`;
              return (
                <div key={row.address} style={{ padding: 10, border: "1px solid #2a2a2a", borderRadius: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div>
                      <div>
                        <strong>Address:</strong> {row.address}
                        {knownLabel ? <span style={{ marginLeft: 6, color: "#90caf9" }}>({knownLabel})</span> : null}
                      </div>
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
          <div style={{ padding: 10, border: "1px solid #2a2a2a", borderRadius: 8, marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Summary</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div>
                <strong>Pending txs:</strong> {nonceLatest != null && noncePending != null && noncePending > nonceLatest ? "Yes" : "No"}
                {nonceLatest != null && noncePending != null && noncePending > nonceLatest ? (
                  <span style={{ marginLeft: 8 }}>
                    <Link to="/tx-queue">Open Tx Queue</Link>
                  </span>
                ) : null}
              </div>
              <div>
                <strong>Unlimited approvals found:</strong> {lastAllowanceUnlimited && lastCheckedToken && lastCheckedSpender ? "Yes" : "No"}
                {lastAllowanceUnlimited && lastCheckedToken && lastCheckedSpender ? (
                  <button
                    style={{ marginLeft: 8 }}
                    onClick={() => setActiveTab("approvals")}
                  >
                    Open Approvals
                  </button>
                ) : null}
              </div>
              <div>
                <strong>Unknown contracts:</strong> {unknownContracts.length}
                {unknownContracts.length ? (
                  <button
                    style={{ marginLeft: 8 }}
                    onClick={() => setActiveTab("activity")}
                  >
                    Open Activity
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Risk Signals</div>
          <div style={{ color: "#bdbdbd", marginBottom: 10 }}>Signals, not guarantees.</div>

          <div style={{ marginTop: 8, padding: 10, border: "1px solid #2a2a2a", borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Pending/stuck txs</div>
            {nonceLatest != null && noncePending != null && noncePending > nonceLatest ? (
              <div style={{ color: "#ffb74d" }}>
                Pending nonce is higher than latest. You may have a stuck transaction. {" "}
                <Link to="/tx-queue">Open Tx Queue</Link> · <Link to="/nonce-rescue">Nonce Rescue</Link>
              </div>
            ) : (
              <div style={{ color: "#bdbdbd" }}>No pending nonce risk detected.</div>
            )}
          </div>

          <div style={{ marginTop: 12, padding: 10, border: "1px solid #2a2a2a", borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Unlimited approvals</div>
            {scanResults.length === 0 ? (
              <div style={{ color: "#bdbdbd" }}>Run the Approvals Scanner to evaluate allowances.</div>
            ) : unlimitedApprovals.length === 0 ? (
              <div style={{ color: "#bdbdbd" }}>No unlimited approvals detected in scan results.</div>
            ) : (
              <div>
                <div style={{ color: "#ffb74d", marginBottom: 8 }}>
                  Unlimited approvals found: {unlimitedApprovals.length}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {unlimitedApprovals.slice(0, 5).map((row) => (
                    <div key={`${row.tokenAddress}:${row.spender}`} style={{ padding: 8, border: "1px solid #2a2a2a", borderRadius: 8 }}>
                      <div>
                        <strong>Token:</strong> {row.symbol ? `${row.symbol} (${row.tokenAddress})` : row.tokenAddress}
                      </div>
                      <div><strong>Spender:</strong> {row.spender}</div>
                      <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button onClick={() => jumpToApprovals(row.tokenAddress, row.spender)}>
                          Open Approvals
                        </button>
                        <button
                          onClick={() => {
                            setActiveTab("approvals");
                            jumpToApprovals(row.tokenAddress, row.spender);
                          }}
                        >
                          Revoke
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 12, padding: 10, border: "1px solid #2a2a2a", borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Unknown contract activity</div>
            {unknownContracts.length === 0 ? (
              <div style={{ color: "#bdbdbd" }}>No unknown contracts found.</div>
            ) : (
              <div>
                <div style={{ color: "#ffb74d", marginBottom: 6 }}>
                  Unknown contracts: {unknownContracts.length}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {unknownContracts.slice(0, 5).map((row) => (
                    <div key={row.address} style={{ padding: 8, border: "1px solid #2a2a2a", borderRadius: 8 }}>
                      <div><strong>Address:</strong> {row.address}</div>
                      <div style={{ marginTop: 6 }}>
                        <button onClick={() => setActiveTab("activity")}>Open Activity</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      ) : null}

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
