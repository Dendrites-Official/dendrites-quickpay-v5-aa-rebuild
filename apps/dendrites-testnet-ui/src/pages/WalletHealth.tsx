import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ethers } from "ethers";
import { qpUrl } from "../lib/quickpayApiBase";
import { getQuickPayChainConfig } from "../lib/quickpayChainConfig";
import { logEvent } from "../lib/analytics";
import MainnetConfirmModal from "../components/MainnetConfirmModal";
import { estimateTxCost } from "../lib/txEstimate";
import { normalizeWalletError } from "../lib/walletErrors";
import { switchToBase, switchToBaseSepolia } from "../lib/switchChain";
import { useWalletState } from "../demo/useWalletState";
import { useWalletHealthData } from "../demo/useWalletHealthData";

export default function WalletHealth() {
  const { address, isConnected, chainId } = useWalletState();
  const { isDemo, demoData } = useWalletHealthData();
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
  const [switchStatus, setSwitchStatus] = useState("");
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
  const displayChainLabel = chainId === 8453 ? "Base" : chainId === 84532 ? "Base Sepolia" : networkLabel;
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
    if (isDemo) {
      setMdndxAddress(demoData.mdndxAddress ?? null);
      setMdndxDecimals(demoData.mdndxDecimals ?? null);
      return;
    }
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
  }, [demoData.mdndxAddress, demoData.mdndxDecimals, isDemo]);

  useEffect(() => {
    if (loggedOpenRef.current) return;
    loggedOpenRef.current = true;
    void logEvent("wallet_health_open", { tab: "overview" }, address ?? null, chainId ?? null);
  }, [address, chainId]);

  const loadOverview = useCallback(async () => {
    setError("");
    if (isDemo) {
      setLoading(true);
      setNonceLatest(demoData.nonceLatest);
      setNoncePending(demoData.noncePending);
      setNativeBalance(demoData.nativeBalance);
      setTokenBalances(demoData.tokenBalances);
      setTokenMeta(demoData.tokenMeta);
      setScanResults(demoData.scanResults);
      setScanProgress({ done: demoData.scanResults.length, total: demoData.scanResults.length });
      setLoading(false);
      return;
    }
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
  }, [address, demoData, isConnected, isDemo, mdndxAddress, mdndxDecimals]);

  useEffect(() => {
    tokenMetaRef.current = tokenMeta;
  }, [tokenMeta]);

  useEffect(() => {
    tagMapRef.current = tagMap;
  }, [tagMap]);

  const loadActivity = useCallback(async () => {
    setActivityError("");
    if (isDemo) {
      setActivityRows(demoData.activityRows);
      setExplorerBaseUrl(demoData.explorerBaseUrl);
      setActivityLoading(false);
      return;
    }
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
              isContract = code !== "0x";
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
  }, [address, chainId, demoData.activityRows, demoData.explorerBaseUrl, isConnected, isDemo]);

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

    if (isDemo) {
      setApprovalError("Demo mode: approvals are disabled.");
      return;
    }

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
    } catch (err: any) {
      setApprovalError(err?.message || "Failed to fetch allowance.");
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
      if (isDemo) {
        setApprovalError("Demo mode: approvals are disabled.");
        return;
      }
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
      if (isDemo) {
        setApprovalError("Demo mode: approvals are disabled.");
        return;
      }
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
    if (isDemo) {
      setScanResults(demoData.scanResults);
      setScanProgress({ done: demoData.scanResults.length, total: demoData.scanResults.length });
      setScanLoading(false);
      return;
    }
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
  }, [address, chainId, demoData.scanResults, isConnected, isDemo]);

  useEffect(() => {
    if (activeTab !== "overview") return;
    const run = async () => {
      await loadMdndxConfig();
      await loadOverview();
    };
    run();
  }, [activeTab, loadMdndxConfig, loadOverview]);

  useEffect(() => {
    if (!address || !isConnected) return;
    if (activeTab === "overview" || activeTab === "risk") {
      loadOverview();
    }
    if (activeTab === "activity" || activeTab === "risk") {
      loadActivity();
    }
  }, [activeTab, address, chainId, isConnected, loadActivity, loadOverview]);

  useEffect(() => {
    const ethereum = (window as any)?.ethereum;
    if (!ethereum?.on) return;
    const handler = () => {
      if (!address || !isConnected) return;
      if (activeTab === "overview" || activeTab === "risk") {
        loadOverview();
      }
      if (activeTab === "activity" || activeTab === "risk") {
        loadActivity();
      }
    };
    ethereum.on("chainChanged", handler);
    return () => {
      if (ethereum?.removeListener) {
        ethereum.removeListener("chainChanged", handler);
      }
    };
  }, [activeTab, address, isConnected, loadActivity, loadOverview]);

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


 return (
  <main className="dx-container dx-container--full">
    <header>
      <div className="dx-kicker">DENDRITES</div>
      <h1 className="dx-h1">Wallet Health</h1>
      <p className="dx-sub">Quick snapshot of wallet status and basic risk signals.</p>
    </header>

    {/* Top bar */}
    <section className="dx-card" style={{ marginTop: 14 }}>
      <div className="dx-card-in">
        <div className="dx-card-head">
          <h2 className="dx-card-title">Network</h2>
          <p className="dx-card-hint">Tools</p>
        </div>

        <div className="dx-rowInline" style={{ justifyContent: "space-between" }}>
          <div className="dx-muted">
            <strong style={{ color: "rgba(255,255,255,0.92)" }}>Active:</strong>{" "}
            {displayChainLabel} {chainId ? `(${chainId})` : ""}
          </div>

          <div className="dx-miniRow" style={{ marginTop: 0 }}>
            <button
              className="dx-miniBtn"
              onClick={async () => {
                if (isDemo) return;
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
              disabled={isDemo}
            >
              Switch to Base
            </button>

            <button
              className="dx-miniBtn"
              onClick={async () => {
                if (isDemo) return;
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
              disabled={isDemo}
            >
              Switch to Base Sepolia
            </button>
          </div>
        </div>

        {switchStatus ? <div className="dx-muted" style={{ marginTop: 10 }}>{switchStatus}</div> : null}
      </div>
    </section>

    {/* Snapshot */}
    <section className="dx-card" style={{ marginTop: 14 }}>
      <div className="dx-card-in">
        <div className="dx-card-head">
          <h2 className="dx-card-title">Investor Snapshot</h2>
          <p className="dx-card-hint">High-level</p>
        </div>

        <div className="dx-kv">
          <div className="dx-k">Connected</div>
          <div className="dx-v">{statusAddress}</div>

          <div className="dx-k">Chain</div>
          <div className="dx-v">{statusChain}</div>

          <div className="dx-k">Pending txs</div>
          <div className="dx-v">
            {nonceLatest != null && noncePending != null && noncePending > nonceLatest ? (
              <span className="dx-chip dx-chipWarn">Yes</span>
            ) : (
              <span className="dx-chip dx-chipOk">No</span>
            )}
          </div>

          <div className="dx-k">Unlimited approvals</div>
          <div className="dx-v">
            <span className="dx-chip">{unlimitedApprovals.length}</span>
          </div>

          <div className="dx-k">Unknown contracts</div>
          <div className="dx-v">
            <span className="dx-chip">{unknownContracts.length}</span>
          </div>
        </div>

        <div className="dx-miniRow" style={{ marginTop: 12 }}>
          <Link to="/tx-queue" className="dx-miniLink">View Tx Queue</Link>
          <button className="dx-miniBtn" onClick={handleScanApprovals} disabled={scanLoading}>
            {scanLoading ? "Scanning..." : "Scan Approvals"}
          </button>
          <button className="dx-miniBtn" onClick={() => setActiveTab("activity")}>Open Activity</button>
        </div>
      </div>
    </section>

    {/* Tabs */}
    <div className="dx-miniRow" style={{ marginTop: 14 }}>
      <button
        className={activeTab === "overview" ? "dx-miniLink" : "dx-miniBtn"}
        onClick={() => setActiveTab("overview")}
      >
        Overview
      </button>
      <button
        className={activeTab === "approvals" ? "dx-miniLink" : "dx-miniBtn"}
        onClick={() => setActiveTab("approvals")}
      >
        Approvals
      </button>
      <button
        className={activeTab === "activity" ? "dx-miniLink" : "dx-miniBtn"}
        onClick={() => setActiveTab("activity")}
      >
        Activity
      </button>
      <button
        className={activeTab === "risk" ? "dx-miniLink" : "dx-miniBtn"}
        onClick={() => setActiveTab("risk")}
      >
        Risk
      </button>

      <Link to="/tx-queue" className="dx-miniBtn">Tx Queue</Link>
      <Link to="/nonce-rescue" className="dx-miniBtn">Nonce Rescue</Link>
    </div>

    {/* OVERVIEW */}
    {activeTab === "overview" ? (
      <section className="dx-card" style={{ marginTop: 14 }}>
        <div className="dx-card-in">
          <div className="dx-card-head">
            <h2 className="dx-card-title">Overview</h2>
            <p className="dx-card-hint">Connection</p>
          </div>

          <div className="dx-kv">
            <div className="dx-k">Connected Address</div>
            <div className="dx-v">{statusAddress}</div>

            <div className="dx-k">Chain ID</div>
            <div className="dx-v">{statusChain}</div>

            <div className="dx-k">Provider</div>
            <div className="dx-v">{providerAvailable ? "Detected" : "Not available"}</div>

            <div className="dx-k">Nonce (latest)</div>
            <div className="dx-v">{nonceLatest ?? "—"}</div>

            <div className="dx-k">Nonce (pending)</div>
            <div className="dx-v">{noncePending ?? "—"}</div>

            <div className="dx-k">Native Balance (ETH)</div>
            <div className="dx-v">{nativeBalance ?? "—"}</div>

            <div className="dx-k">USDC</div>
            <div className="dx-v">
              {tokenBalances["0x036CbD53842c5426634e7929541eC2318f3dCF7e"] ?? "—"}
            </div>

            <div className="dx-k">mDNDX</div>
            <div className="dx-v">
              {mdndxAddress ? `${tokenMeta[mdndxAddress]?.symbol || "mDNDX"}: ${tokenBalances[mdndxAddress] ?? "—"}` : "—"}
            </div>
          </div>

          {error ? <div className="dx-alert dx-alert-danger" style={{ marginTop: 12 }}>{error}</div> : null}

          <div className="dx-miniRow" style={{ marginTop: 12 }}>
            <button
              className="dx-miniBtn"
              onClick={async () => {
                await loadMdndxConfig();
                await loadOverview();
              }}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <div className="dx-muted">
              Signer and provider actions are handled via the existing wallet connection.
            </div>
          </div>
        </div>
      </section>
    ) : null}

    {/* APPROVALS */}
    {activeTab === "approvals" ? (
      <section className="dx-card" style={{ marginTop: 14 }}>
        <div className="dx-card-in">
          <div className="dx-card-head">
            <h2 className="dx-card-title">Approvals</h2>
            <p className="dx-card-hint">Allowances</p>
          </div>

          {/* Scanner */}
          <div className="dx-section">
            <div className="dx-rowInline" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>Approvals Scanner (v2)</div>
                <div className="dx-muted" style={{ marginTop: 4 }}>
                  Scan tokens the wallet touched and check allowances for default spenders.
                </div>
              </div>

              <button className="dx-miniBtn" onClick={handleScanApprovals} disabled={scanLoading}>
                {scanLoading ? "Scanning..." : "Scan approvals"}
              </button>
            </div>

            {scanLoading ? (
              <div className="dx-muted" style={{ marginTop: 10 }}>
                Scanning tokens... {scanProgress.done}/{scanProgress.total || "?"}
              </div>
            ) : null}

            {scanError ? <div className="dx-alert dx-alert-danger" style={{ marginTop: 10 }}>{scanError}</div> : null}

            {scanResults.length ? (
              <div className="dx-tableWrap" style={{ marginTop: 12 }}>
                <div className="dx-tableScroll">
                  <table className="dx-table">
                    <thead>
                      <tr>
                        <th className="dx-th">Token</th>
                        <th className="dx-th">Spender</th>
                        <th className="dx-th">Allowance</th>
                        <th className="dx-th">Risk</th>
                        <th className="dx-th">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scanResults.map((token) => {
                        const tokenLabel = token.symbol ? `${token.symbol} (${token.tokenAddress})` : token.tokenAddress;

                        if (token.error) {
                          return (
                            <tr key={token.tokenAddress}>
                              <td className="dx-td" colSpan={5}>
                                <span className="dx-muted">{tokenLabel}:</span>{" "}
                                <span className="dx-danger">{token.error}</span>
                              </td>
                            </tr>
                          );
                        }

                        return token.allowances.map((allowance, idx) => {
                          const key = `${token.tokenAddress}:${allowance.spender}:${idx}`;
                          const inputKey = `${token.tokenAddress}:${allowance.spender}`;
                          const limitValue = scanLimitInputs[inputKey] ?? "";

                          return (
                            <tr className="dx-row" key={key}>
                              <td className="dx-td">{tokenLabel}</td>
                              <td className="dx-td dx-mono">{allowance.spender}</td>
                              <td className="dx-td">{allowance.allowance}</td>
                              <td className="dx-td">
                                {allowance.isUnlimited ? (
                                  <span className="dx-chip dx-chipWarn">Unlimited</span>
                                ) : (
                                  <span className="dx-chip dx-chipOk">OK</span>
                                )}
                              </td>
                              <td className="dx-td">
                                <div className="dx-miniRow" style={{ marginTop: 0 }}>
                                  <button
                                    className="dx-miniBtn"
                                    onClick={() => handleApproveFor(token.tokenAddress, allowance.spender, 0n)}
                                    disabled={approvalLoading}
                                  >
                                    Revoke
                                  </button>

                                  <input
                                    className="dx-mono"
                                    style={{ width: 140 }}
                                    placeholder="Set limit"
                                    value={limitValue}
                                    onChange={(e) =>
                                      setScanLimitInputs((prev) => ({ ...prev, [inputKey]: e.target.value }))
                                    }
                                  />

                                  <button
                                    className="dx-miniBtn"
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
                                  <div className="dx-danger" style={{ marginTop: 8 }}>{allowance.error}</div>
                                ) : null}
                              </td>
                            </tr>
                          );
                        });
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>

          {/* Manual check */}
          <div className="dx-section" style={{ marginTop: 14 }}>
            <div className="dx-rowInline" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>Manual allowance check</div>
                <div className="dx-muted" style={{ marginTop: 4 }}>Check & manage a specific token/spender pair.</div>
              </div>
              <button className="dx-miniBtn" onClick={handleCheckAllowance} disabled={approvalLoading}>
                {approvalLoading ? "Checking..." : "Check Allowance"}
              </button>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <label className="dx-field">
                <span className="dx-label">Token address</span>
                <input
                  className="dx-mono"
                  placeholder="0x… token"
                  value={tokenAddress}
                  onChange={(e) => setTokenAddress(e.target.value)}
                />
              </label>

              <label className="dx-field">
                <span className="dx-label">Spender</span>
                <select
                  value={spenderMode}
                  onChange={(e) => setSpenderMode(e.target.value as "permit2" | "router" | "custom")}
                  style={{ maxWidth: 360 }}
                >
                  <option value="permit2">Permit2</option>
                  {quickpayRouter ? <option value="router">QuickPay Router</option> : null}
                  <option value="custom">Custom</option>
                </select>
              </label>

              {spenderMode === "custom" ? (
                <label className="dx-field">
                  <span className="dx-label">Custom spender address</span>
                  <input
                    className="dx-mono"
                    placeholder="0x… spender"
                    value={customSpender}
                    onChange={(e) => setCustomSpender(e.target.value)}
                  />
                </label>
              ) : null}
            </div>

            {tokenDetails ? (
              <div style={{ marginTop: 12 }}>
                <div className="dx-kv">
                  <div className="dx-k">Token</div>
                  <div className="dx-v">
                    {tokenDetails.symbol} <span className="dx-muted">(decimals: {tokenDetails.decimals})</span>
                  </div>

                  <div className="dx-k">Allowance</div>
                  <div className="dx-v">{allowanceFormatted ?? "—"}</div>

                  <div className="dx-k">Unlimited</div>
                  <div className="dx-v">
                    {allowance != null && allowance >= ethers.MaxUint256 / 2n ? (
                      <span className="dx-chip dx-chipWarn">Yes</span>
                    ) : (
                      <span className="dx-chip dx-chipOk">No</span>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="dx-miniRow" style={{ marginTop: 12 }}>
              <button className="dx-miniBtn" onClick={() => handleApprove(0n)} disabled={approvalLoading}>
                Revoke
              </button>

              <input
                className="dx-mono"
                style={{ width: 220 }}
                placeholder="Set limit"
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
              />

              <button
                className="dx-miniBtn"
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
              <div className="dx-alert" style={{ marginTop: 12 }}>
                <div><strong>Tx Hash:</strong> <span className="dx-mono">{txHash}</span></div>
                {txStatus ? <div><strong>Status:</strong> {txStatus}</div> : null}
              </div>
            ) : null}

            {approvalError ? (
              <div className="dx-alert dx-alert-danger" style={{ marginTop: 12 }}>
                {approvalError}
                {approvalErrorDetails ? (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: "pointer" }}>Technical details</summary>
                    <div className="dx-muted" style={{ marginTop: 8 }}>{approvalErrorDetails}</div>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    ) : null}

    {/* ACTIVITY */}
    {activeTab === "activity" ? (
      <section className="dx-card" style={{ marginTop: 14 }}>
        <div className="dx-card-in">
          <div className="dx-card-head">
            <h2 className="dx-card-title">Activity</h2>
            <p className="dx-card-hint">Recent</p>
          </div>

          <div className="dx-rowInline" style={{ justifyContent: "space-between" }}>
            <div className="dx-muted">Contracts interacted recently (grouped by recipient address).</div>
            <button className="dx-miniBtn" onClick={loadActivity} disabled={activityLoading}>
              {activityLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {activityError ? <div className="dx-alert dx-alert-warn" style={{ marginTop: 12 }}>{activityError}</div> : null}
          {!activityError && activityRows.length === 0 ? (
            <div className="dx-alert" style={{ marginTop: 12 }}>No activity found.</div>
          ) : null}

          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            {activityRows.map((row) => {
              const lastSeenLabel = row.lastSeen ? new Date(row.lastSeen * 1000).toLocaleString() : "—";
              const knownLabel = knownLabels[row.address.toLowerCase()];
              const tagKey = `walletHealthTag:${chainId ?? "0"}:${row.address.toLowerCase()}`;

              return (
                <div key={row.address} className="dx-section">
                  <div className="dx-rowInline" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 260 }}>
                      <div className="dx-rowInline">
                        <span className="dx-mono">{row.address}</span>
                        {knownLabel ? <span className="dx-chip dx-chipBlue">{knownLabel}</span> : null}
                      </div>
                      <div className="dx-muted" style={{ marginTop: 8 }}>
                        <div><strong style={{ color: "rgba(255,255,255,0.88)" }}>Type:</strong> {row.isContract === null ? "Unknown" : row.isContract ? "Contract" : "EOA"}</div>
                        <div><strong style={{ color: "rgba(255,255,255,0.88)" }}>Count:</strong> {row.count}</div>
                        <div><strong style={{ color: "rgba(255,255,255,0.88)" }}>Last seen:</strong> {lastSeenLabel}</div>
                      </div>
                    </div>

                    <div style={{ width: 280 }}>
                      <div className="dx-label" style={{ marginBottom: 6 }}>Tag</div>
                      <input
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

                  <div className="dx-miniRow" style={{ marginTop: 12 }}>
                    <button
                      className="dx-miniBtn"
                      onClick={() => setExpandedRows((prev) => ({ ...prev, [row.address]: !prev[row.address] }))}
                    >
                      {expandedRows[row.address] ? "Hide" : "Show"} last 5 txs
                    </button>
                  </div>

                  {expandedRows[row.address] ? (
                    <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                      {row.hashes.map((hash) => (
                        <a
                          key={hash}
                          className="dx-mono"
                          href={explorerBaseUrl ? `${explorerBaseUrl}/tx/${hash}` : undefined}
                          target="_blank"
                          rel="noreferrer"
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
      </section>
    ) : null}

    {/* RISK */}
    {activeTab === "risk" ? (
      <section className="dx-card" style={{ marginTop: 14 }}>
        <div className="dx-card-in">
          <div className="dx-card-head">
            <h2 className="dx-card-title">Risk</h2>
            <p className="dx-card-hint">Signals</p>
          </div>

          <div className="dx-section">
            <div style={{ fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>Summary</div>
            <div className="dx-divider" />

            <div style={{ display: "grid", gap: 10 }}>
              <div className="dx-rowInline" style={{ justifyContent: "space-between" }}>
                <div className="dx-muted">
                  <strong style={{ color: "rgba(255,255,255,0.88)" }}>Pending txs:</strong>{" "}
                  {nonceLatest != null && noncePending != null && noncePending > nonceLatest ? "Yes" : "No"}
                </div>
                {nonceLatest != null && noncePending != null && noncePending > nonceLatest ? (
                  <Link className="dx-miniLink" to="/tx-queue">Open Tx Queue</Link>
                ) : null}
              </div>

              <div className="dx-rowInline" style={{ justifyContent: "space-between" }}>
                <div className="dx-muted">
                  <strong style={{ color: "rgba(255,255,255,0.88)" }}>Unlimited approvals found:</strong>{" "}
                  {scanResults.length === 0 ? "Not scanned" : unlimitedApprovals.length ? "Yes" : "No"}
                </div>
                <button className="dx-miniBtn" onClick={() => setActiveTab("approvals")}>Open Approvals</button>
              </div>

              <div className="dx-rowInline" style={{ justifyContent: "space-between" }}>
                <div className="dx-muted">
                  <strong style={{ color: "rgba(255,255,255,0.88)" }}>Unknown contracts:</strong>{" "}
                  {unknownContracts.length}
                </div>
                <button className="dx-miniBtn" onClick={() => setActiveTab("activity")}>Open Activity</button>
              </div>
            </div>
          </div>

          <div className="dx-section" style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>Risk signals</div>
            <div className="dx-muted" style={{ marginTop: 6 }}>Signals, not guarantees.</div>

            <div className="dx-divider" />

            <div style={{ display: "grid", gap: 12 }}>
              <div className="dx-section">
                <div style={{ fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>Pending / stuck txs</div>
                <div style={{ marginTop: 6 }}>
                  {nonceLatest != null && noncePending != null && noncePending > nonceLatest ? (
                    <div className="dx-alert dx-alert-warn">
                      Pending nonce is higher than latest. You may have a stuck transaction.{" "}
                      <Link to="/tx-queue">Open Tx Queue</Link> · <Link to="/nonce-rescue">Nonce Rescue</Link>
                    </div>
                  ) : (
                    <div className="dx-muted">No pending nonce risk detected.</div>
                  )}
                </div>
              </div>

              <div className="dx-section">
                <div style={{ fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>Unlimited approvals</div>
                <div style={{ marginTop: 6 }}>
                  {scanResults.length === 0 ? (
                    <div className="dx-muted">Run the Approvals Scanner to evaluate allowances.</div>
                  ) : unlimitedApprovals.length === 0 ? (
                    <div className="dx-muted">No unlimited approvals detected in scan results.</div>
                  ) : (
                    <div className="dx-alert dx-alert-warn">
                      Unlimited approvals found: {unlimitedApprovals.length}
                    </div>
                  )}
                </div>
              </div>

              <div className="dx-section">
                <div style={{ fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>Unknown contract activity</div>
                <div style={{ marginTop: 6 }}>
                  {unknownContracts.length === 0 ? (
                    <div className="dx-muted">No unknown contracts found.</div>
                  ) : (
                    <div className="dx-alert dx-alert-warn">Unknown contracts: {unknownContracts.length}</div>
                  )}
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>
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
  </main>
);

}
