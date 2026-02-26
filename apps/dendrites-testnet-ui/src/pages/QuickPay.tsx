import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount, usePublicClient, useSignTypedData } from "wagmi";
import { ethers } from "ethers";
import ReceiptCard from "../components/ReceiptCard";
import { createReceipt, updateReceiptMeta, updateReceiptStatus } from "../lib/receiptsApi";
import { quickpayReceipt } from "../lib/api";
import { getQuickPayChainConfig } from "../lib/quickpayChainConfig";
import { qpUrl } from "../lib/quickpayApiBase";
import { logAppEvent } from "../lib/appEvents";

export default function QuickPay() {
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: 84532 });
  const { signTypedDataAsync } = useSignTypedData();
  const [token, setToken] = useState("");
  const [tokenPreset, setTokenPreset] = useState("custom");
  const [decimals, setDecimals] = useState(18);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [reason, setReason] = useState("");
  const [speed, setSpeed] = useState<0 | 1>(1);
  const [mode, setMode] = useState<"SPONSORED" | "SELF_PAY">("SPONSORED");
  const [quote, setQuote] = useState<any>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quotePending, setQuotePending] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [, setSelfPayGasEstimate] = useState("");
  const [, setSelfPayGasError] = useState("");
  const quoteAbortRef = useRef<AbortController | null>(null);
  const quoteDebounceRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [phase, setPhase] = useState<
    | "idle"
    | "approve"
    | "permit2"
    | "eip3009"
    | "eip2612"
    | "userop"
    | "send"
    | "done"
    | "error"
  >("idle");

  const isValidAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value);
  const isUserOpHash = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value);
  const amountValid = useMemo(() => {
    try {
      return ethers.parseUnits(amount, decimals) > 0n;
    } catch {
      return false;
    }
  }, [amount, decimals]);

  const mdndxToken = String(import.meta.env.VITE_MDNDX ?? "").trim();
  const tokenOptions = useMemo(
    () => [
      {
        value: "usdc",
        label: "USDC (Base Sepolia)",
        address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        decimals: 6,
      },
      {
        value: "weth",
        label: "WETH (Base Sepolia)",
        address: "0x4200000000000000000000000000000000000006",
        decimals: 18,
      },
      {
        value: "aero",
        label: "AERO (Base mainnet)",
        address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
        decimals: 18,
      },
      {
        value: "mdndx",
        label: "mDNDX",
        address: mdndxToken,
        decimals: 18,
      },
      {
        value: "custom",
        label: "Custom",
        address: "",
        decimals: 18,
      },
    ],
    [mdndxToken]
  );

  const selectedTokenPreset = tokenOptions.find((option) => option.value === tokenPreset);
  const isCustomToken = selectedTokenPreset?.value === "custom";
  const tokenLocked = !isCustomToken && Boolean(selectedTokenPreset?.address);
  const decimalsLocked = !isCustomToken;

  const speedLabel = speed === 0 ? "eco" : "instant";
  const quoteBusy = quotePending || quoteLoading;

  const fetchQuote = async (signal?: AbortSignal) => {
    const amountRaw = ethers.parseUnits(amount, decimals).toString();
    const body = {
      chainId: 84532,
      ownerEoa: address,
      token,
      to,
      amount: amountRaw,
      feeMode: speedLabel,
      speed,
      mode,
    };
    console.log("QUOTE_BODY", body);

    const res = await fetch(qpUrl("/quote"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 400 || data?.ok === false) {
      const details = data?.details ? ` ${JSON.stringify(data.details)}` : "";
      throw new Error(`${data?.error || "Bad request"}${details}`.trim());
    }
    if (!res.ok) throw new Error(data?.error || "Failed to get quote");
    return data;
  };

  const getQuote = async (signal?: AbortSignal) => {
    if (!address) {
      setQuoteError("Connect wallet first.");
      return;
    }
    if (!isValidAddress(token) || !isValidAddress(to) || !amountValid) {
      setQuoteError("Enter valid token, recipient, and amount.");
      return;
    }
    setQuoteLoading(true);
    setQuotePending(false);
    setQuoteError("");
    setQuote(null);
    try {
      const data = await fetchQuote(signal);
      setQuote(data);
      void logAppEvent("quickpay_quote_success", {
        address,
        meta: {
          token,
          to,
          amount,
          mode,
          speed,
        },
      });
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setQuoteError(err?.message || "Failed to get quote");
      void logAppEvent("quickpay_quote_error", {
        address,
        meta: {
          token,
          to,
          amount,
          mode,
          speed,
          message: String(err?.message || "quote_failed"),
        },
      });
    } finally {
      if (!signal?.aborted) {
        setQuoteLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!isConnected || !address) {
      quoteAbortRef.current?.abort();
      setQuotePending(false);
      setQuoteLoading(false);
      return;
    }
    if (!isValidAddress(token) || !isValidAddress(to) || !amountValid) {
      quoteAbortRef.current?.abort();
      setQuotePending(false);
      setQuoteLoading(false);
      return;
    }

    if (quoteDebounceRef.current) {
      window.clearTimeout(quoteDebounceRef.current);
    }

    quoteDebounceRef.current = window.setTimeout(() => {
      quoteAbortRef.current?.abort();
      const controller = new AbortController();
      quoteAbortRef.current = controller;
      getQuote(controller.signal);
    }, 400);
    setQuotePending(true);

    return () => {
      if (quoteDebounceRef.current) {
        window.clearTimeout(quoteDebounceRef.current);
      }
    };
  }, [address, amount, amountValid, decimals, isConnected, mode, speed, to, token]);

  useEffect(() => {
    return () => {
      quoteAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setSelfPayGasEstimate("");
      setSelfPayGasError("");
      if (mode !== "SELF_PAY") return;
      if (!publicClient || !address) return;
      if (!isValidAddress(token) || !isValidAddress(to) || !amountValid) return;

      try {
        const amountRaw = ethers.parseUnits(amount, decimals);
        const gasLimit = await publicClient.estimateContractGas({
          address: token as `0x${string}`,
          abi: [
            {
              type: "function",
              name: "transfer",
              stateMutability: "nonpayable",
              inputs: [
                { name: "to", type: "address" },
                { name: "value", type: "uint256" },
              ],
              outputs: [{ name: "", type: "bool" }],
            },
          ] as const,
          functionName: "transfer",
          args: [to as `0x${string}`, amountRaw],
          account: address as `0x${string}`,
        });
        const gasPrice = await publicClient.getGasPrice();
        const estCostWei = gasLimit * gasPrice;
        const estCostEth = ethers.formatEther(estCostWei);
        if (!cancelled) {
          setSelfPayGasEstimate(`${gasLimit.toString()} gas (≈ ${estCostEth} ETH)`);
        }
      } catch (err: any) {
        if (cancelled) return;
        const rawMessage = String(err?.shortMessage || err?.message || "");
        const message = rawMessage.includes("exceeds balance")
          ? "Insufficient token balance"
          : "Gas estimate unavailable";
        setSelfPayGasEstimate("");
        setSelfPayGasError(message);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [address, amount, amountValid, decimals, mode, publicClient, to, token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    if (!isValidAddress(token) || !isValidAddress(to) || !amountValid) {
      setError("Enter valid token, recipient, and amount.");
      return;
    }
    setLoading(true);
    setError("");
    setStatus("");
    setReceipt(null);
    setPhase("idle");
    let receiptId: string | null = null;
    try {
      const chainId = 84532;
      const senderLower = address.toLowerCase();

      let activeQuote = quote;
      if (!activeQuote) {
        activeQuote = await fetchQuote();
        setQuote(activeQuote);
      }

      const lane = String(activeQuote?.lane ?? "").toUpperCase();
      const amountRaw = ethers.parseUnits(amount, decimals).toString();
      let auth: any = null;
      let eip3009Router: string | undefined;
      const client = publicClient;
      const needsPublicClient =
        mode === "SPONSORED" && (lane === "EIP3009" || lane === "EIP2612" || lane === "PERMIT2");
      if (needsPublicClient && !client) {
        setError("Wallet client unavailable. Please reconnect and try again.");
        setLoading(false);
        return;
      }
      if (mode === "SPONSORED" && lane === "EIP3009") {
        if (!client) {
          setError("Wallet client unavailable. Please reconnect and try again.");
          setLoading(false);
          return;
        }
        setPhase("eip3009");
        const routerAddr = String(activeQuote?.router ?? getQuickPayChainConfig(chainId)?.router ?? "");
        if (!ethers.isAddress(routerAddr)) {
          setError("Missing router address for EIP3009");
          setLoading(false);
          return;
        }
        eip3009Router = routerAddr;
        const tokenAddress = token as `0x${string}`;
        const routerAddress = routerAddr as `0x${string}`;
        const senderAddress = senderLower as `0x${string}`;
        const eip3009Abi = [
          { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
          { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
        ] as const;
        let tokenName = "USD Coin";
        let tokenVersion = "2";
        try {
          tokenName = await client.readContract({
            address: tokenAddress,
            abi: eip3009Abi,
            functionName: "name",
          });
        } catch {}
        try {
          tokenVersion = await client.readContract({
            address: tokenAddress,
            abi: eip3009Abi,
            functionName: "version",
          });
        } catch {}
        const now = Math.floor(Date.now() / 1000);
        const validAfter = now - 10;
        const validBefore = now + 60 * 60;
        const nonce = ethers.hexlify(ethers.randomBytes(32)) as `0x${string}`;
        const typedData = {
          domain: {
            name: tokenName,
            version: tokenVersion,
            chainId,
            verifyingContract: tokenAddress,
          },
          types: {
            ReceiveWithAuthorization: [
              { name: "from", type: "address" },
              { name: "to", type: "address" },
              { name: "value", type: "uint256" },
              { name: "validAfter", type: "uint256" },
              { name: "validBefore", type: "uint256" },
              { name: "nonce", type: "bytes32" },
            ],
          },
          primaryType: "ReceiveWithAuthorization",
          message: {
            from: senderAddress,
            to: routerAddress,
            value: BigInt(amountRaw),
            validAfter: BigInt(validAfter),
            validBefore: BigInt(validBefore),
            nonce,
          },
        } as const;
        const signature = await signTypedDataAsync(typedData);
        auth = { type: "EIP3009", ...typedData.message, signature };
      }
      if (mode === "SPONSORED" && lane === "EIP2612") {
        if (!client) {
          setError("Wallet client unavailable. Please reconnect and try again.");
          setLoading(false);
          return;
        }
        setPhase("eip2612");
        const routerAddr = String(activeQuote?.router ?? getQuickPayChainConfig(chainId)?.router ?? "");
        if (!ethers.isAddress(routerAddr)) {
          setError("Missing router address for EIP2612");
          setLoading(false);
          return;
        }
        const tokenAddress = token as `0x${string}`;
        const routerAddress = routerAddr as `0x${string}`;
        const senderAddress = senderLower as `0x${string}`;
        const permitAbi = [
          { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
          { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
          { type: "function", name: "nonces", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
        ] as const;
        let tokenName = "Token";
        let tokenVersion = "1";
        let nonce = 0n;
        try {
          tokenName = await client.readContract({
            address: tokenAddress,
            abi: permitAbi,
            functionName: "name",
          });
        } catch {}
        try {
          tokenVersion = await client.readContract({
            address: tokenAddress,
            abi: permitAbi,
            functionName: "version",
          });
        } catch {}
        try {
          nonce = await client.readContract({
            address: tokenAddress,
            abi: permitAbi,
            functionName: "nonces",
            args: [senderAddress],
          });
        } catch {}
        const deadline = Math.floor(Date.now() / 1000) + 60 * 60;
        const typedData = {
          domain: {
            name: tokenName,
            version: tokenVersion,
            chainId,
            verifyingContract: tokenAddress,
          },
          types: {
            Permit: [
              { name: "owner", type: "address" },
              { name: "spender", type: "address" },
              { name: "value", type: "uint256" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
          },
          primaryType: "Permit",
          message: {
            owner: senderAddress,
            spender: routerAddress,
            value: BigInt(amountRaw),
            nonce: BigInt(nonce),
            deadline: BigInt(deadline),
          },
        } as const;
        const signature = await signTypedDataAsync(typedData);
        auth = { type: "EIP2612", ...typedData.message, signature };
      }
      if (mode === "SPONSORED" && lane === "PERMIT2") {
        if (!client) {
          setError("Wallet client unavailable. Please reconnect and try again.");
          setLoading(false);
          return;
        }
        setPhase("permit2");
        const permit2Address = String(activeQuote?.permit2 ?? "0x000000000022D473030F116dDEE9F6B43aC78BA3");
        const spender = String(activeQuote?.router ?? "");
        if (!ethers.isAddress(permit2Address)) {
          throw new Error("Missing Permit2 address");
        }
        if (!ethers.isAddress(spender)) {
          throw new Error("Missing router address for Permit2");
        }
        const permit2AddressTyped = permit2Address as `0x${string}`;
        const spenderAddress = spender as `0x${string}`;
        const tokenAddress = token as `0x${string}`;
        const senderAddress = senderLower as `0x${string}`;
        // Do not attempt approve here. Server will return NEEDS_APPROVE
        // and optionally stipend ETH for first-time wallets.
        const permit2Abi = [
          {
            type: "function",
            name: "allowance",
            stateMutability: "view",
            inputs: [
              { name: "owner", type: "address" },
              { name: "token", type: "address" },
              { name: "spender", type: "address" },
            ],
            outputs: [
              { name: "amount", type: "uint160" },
              { name: "expiration", type: "uint48" },
              { name: "nonce", type: "uint48" },
            ],
          },
        ] as const;
        const allowance = await client.readContract({
          address: permit2AddressTyped,
          abi: permit2Abi,
          functionName: "allowance",
          args: [senderAddress, tokenAddress, spenderAddress],
        });
        const now = Math.floor(Date.now() / 1000);
        const permitExpiration = now + 60 * 60 * 24 * 30;
        const sigDeadline = now + 60 * 30;
        const typedData = {
          domain: {
            name: "Permit2",
            chainId,
            verifyingContract: permit2AddressTyped,
          },
          types: {
            PermitDetails: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint160" },
              { name: "expiration", type: "uint48" },
              { name: "nonce", type: "uint48" },
            ],
            PermitSingle: [
              { name: "details", type: "PermitDetails" },
              { name: "spender", type: "address" },
              { name: "sigDeadline", type: "uint256" },
            ],
          },
          primaryType: "PermitSingle",
          message: {
            details: {
              token: tokenAddress,
              amount: BigInt(amountRaw),
              expiration: permitExpiration,
              nonce: Number(allowance[2] ?? 0n),
            },
            spender: spenderAddress,
            sigDeadline,
          },
        } as const;
        const signature = await signTypedDataAsync(typedData);
        auth = { type: "PERMIT2", ...typedData.message, signature };
      }

      receiptId = await createReceipt({
        chainId,
        sender: senderLower,
        ownerEoa: senderLower,
        to,
        token,
        amountRaw,
        mode,
        feeMode: speedLabel,
      });

      await updateReceiptMeta(receiptId ?? undefined, {
        name: displayName.trim() || undefined,
        message: message.trim() || undefined,
        reason: reason.trim() || undefined,
        chainId,
      });

      if (receiptId && note.trim()) {
        try {
          const provider = new ethers.BrowserProvider((window as any).ethereum);
          const signer = await provider.getSigner();
          const senderLower = address.toLowerCase();
          const noteMessage = `Dendrites QuickPay Note v1\nAction: SET\nReceipt: ${receiptId}\nSender: ${senderLower}\nChainId: ${chainId}`;
          const signature = await signer.signMessage(noteMessage);
          const { quickpayNoteSet } = await import("../lib/api");
          await quickpayNoteSet({ receiptId, sender: senderLower, note: note.trim(), signature, chainId });
        } catch (err) {
          console.warn("NOTE_SAVE_FAILED", err);
        }
      }

      if (mode === "SELF_PAY") {
        setPhase("send");
        setStatus("Sending wallet transaction…");
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();
        const erc20 = new ethers.Contract(
          token,
          ["function transfer(address to,uint256 value) returns (bool)"],
          signer
        );
        try {
          const transferFn = erc20.getFunction("transfer");
          const gasLimit = await transferFn.estimateGas(to, BigInt(amountRaw));
          const feeData = await provider.getFeeData();
          const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
          const estCostWei = gasLimit * maxFeePerGas;
          const estCostEth = ethers.formatEther(estCostWei);
          setStatus(`Estimated gas: ${gasLimit.toString()} (≈ ${estCostEth} ETH)`);
        } catch {
          // ignore estimate failures
        }
        const tx = await erc20.transfer(to, BigInt(amountRaw));
        const txHash = tx?.hash ? String(tx.hash) : null;
        if (!txHash) {
          throw new Error("Missing transaction hash from wallet");
        }

        updateReceiptMeta(receiptId ?? undefined, {
          txHash,
          chainId,
        }).catch(() => undefined);
        if (receiptId) {
          updateReceiptStatus(receiptId, "PENDING").catch(() => undefined);
        }

        setStatus("Waiting for confirmation…");
        try {
          const mined = await tx.wait();
          const success = mined?.status === 1;
          if (receiptId) {
            updateReceiptStatus(receiptId, success ? "CONFIRMED" : "FAILED").catch(() => undefined);
            quickpayReceipt({ receiptId, txHash, chainId }).catch(() => undefined);
          }
        } catch {
          if (receiptId) {
            updateReceiptStatus(receiptId, "FAILED").catch(() => undefined);
          }
        }

        if (receiptId) {
          navigate(`/r/${receiptId}`);
          return;
        }
        if (txHash) {
          navigate(`/receipts?tx=${txHash}`);
          return;
        }
      }

      const sendPayload: any = {
        chainId,
        ownerEoa: senderLower,
        to,
        token,
        amount: amountRaw,
        feeMode: speedLabel,
        speed,
        mode,
        receiptId,
        quotedFeeTokenAmount: activeQuote?.feeTokenAmount,
        auth,
      };
      if (mode === "SPONSORED" && lane === "EIP3009" && eip3009Router) {
        sendPayload.router = eip3009Router;
      }
      const postSend = async (payload: any) => {
        const body = JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
        const res = await fetch(qpUrl("/send"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Failed to send");
        return data;
      };

      let data = await postSend(sendPayload);
      if (data?.code === "NEEDS_APPROVE" && data?.approve?.to && data?.approve?.data) {
        setPhase("approve");
        setStatus("Approval required (popup 1 of 2)…");
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();
        const approveTx = await signer.sendTransaction({
          to: data.approve.to,
          data: data.approve.data,
        });
        setStatus("Waiting for approval confirmation…");
        await approveTx.wait(1);
        if (publicClient && data?.approve?.spender) {
          const allowanceAbi = [
            {
              type: "function",
              name: "allowance",
              stateMutability: "view",
              inputs: [
                { name: "owner", type: "address" },
                { name: "spender", type: "address" },
              ],
              outputs: [{ name: "", type: "uint256" }],
            },
          ] as const;
          const allowance = await publicClient.readContract({
            address: data.approve.to as `0x${string}`,
            abi: allowanceAbi,
            functionName: "allowance",
            args: [senderLower as `0x${string}`, data.approve.spender as `0x${string}`],
          });
          if (BigInt(allowance) <= 0n) {
            throw new Error("Approval not detected on Base Sepolia. Check wallet network and try again.");
          }
        }
        setPhase("send");
        setStatus("Submitting sponsored transaction…");
        data = await postSend(sendPayload);
      }
      const needsUserOpSig =
        data?.needsUserOpSignature === true && isUserOpHash(String(data?.userOpHash || ""));

      if (needsUserOpSig && !sendPayload.userOpSignature) {
        setPhase("userop");
        setStatus("Waiting for wallet signature (popup 2 of 2)…");
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        let sig: string;
        try {
          const signer = await provider.getSigner();
          sig = await signer.signMessage(ethers.getBytes(data.userOpHash));
        } catch (err: any) {
          setError(err?.message || "Signature failed. This flow requires personal_sign on userOpHash bytes.");
          setLoading(false);
          return;
        }
        const recRaw = ethers.recoverAddress(data.userOpHash, sig);
        const rec191 = ethers.recoverAddress(ethers.hashMessage(ethers.getBytes(data.userOpHash)), sig);
        console.log("USEROP SIGN CHECK", {
          address,
          userOpHash: data.userOpHash,
          recRaw,
          rec191,
        });
        if (!data?.userOpDraft) {
          setError("Missing userOpDraft from server response.");
          setPhase("error");
          setLoading(false);
          return;
        }
        setPhase("send");
        setStatus("Submitting sponsored transaction…");
        data = await postSend({ ...sendPayload, userOpSignature: sig, userOpDraft: data.userOpDraft });
      }

      const userOpHash = data?.userOpHash || data?.userOp?.userOpHash;
      const txHash = data?.txHash ?? data?.tx_hash ?? null;

      void logAppEvent("quickpay_send_success", {
        address,
        meta: {
          receiptId,
          userOpHash,
          txHash,
          mode,
          speed,
          token,
          to,
          amount,
        },
      });

      updateReceiptMeta(receiptId ?? undefined, {
        userOpHash: userOpHash ?? undefined,
        txHash: txHash ?? undefined,
        chainId,
      }).catch(() => undefined);

      if (receiptId) {
        navigate(`/r/${receiptId}`);
        setPhase("done");
        return;
      }
      if (userOpHash) {
        navigate(`/receipts?uop=${userOpHash}`);
        setPhase("done");
        return;
      }
      if (txHash) {
        navigate(`/receipts?tx=${txHash}`);
        setPhase("done");
        return;
      }
      if (data) setReceipt(data);
    } catch (err: any) {
      setError(err?.message || "Failed to send");
      setPhase("error");
      void logAppEvent("quickpay_send_error", {
        address,
        meta: {
          token,
          to,
          amount,
          mode,
          speed,
          message: String(err?.message || "send_failed"),
        },
      });
      if (receiptId) {
        updateReceiptStatus(receiptId, "FAILED").catch(() => undefined);
      }
    } finally {
      setLoading(false);
    }
  };

return (
  <main className="dx-container">
    <header>
      <div className="dx-kicker">DENDRITES</div>
      <h1 className="dx-h1">QuickPay</h1>
      <p className="dx-sub">
        Premium payments UI. Quotes refresh as you type. No extra clicks.
      </p>
    </header>

    <div className="dx-grid">
      {/* LEFT: SEND FORM */}
      <section className="dx-card">
        <div className="dx-card-in">
          <div className="dx-card-head">
            <h2 className="dx-card-title">Send</h2>
            <p className="dx-card-hint">UI only — functionality unchanged</p>
          </div>

          <form onSubmit={submit} className="dx-form">
            <div className="dx-field">
              <span className="dx-label">Token preset</span>
              <select
                value={tokenPreset}
                onChange={(e) => {
                  const nextPreset = e.target.value;
                  setTokenPreset(nextPreset);
                  const selected = tokenOptions.find((option) => option.value === nextPreset);
                  if (!selected) return;
                  if (selected.value === "custom") {
                    setDecimals(18);
                    return;
                  }
                  setToken(selected.address || "");
                  setDecimals(selected.decimals ?? 18);
                }}
              >
                {tokenOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="dx-row2">
              <div className="dx-field">
                <span className="dx-label">Token address</span>
                <input
                  placeholder="0x…"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  readOnly={tokenLocked}
                />
              </div>

              <div className="dx-field">
                <span className="dx-label">Decimals</span>
                <input
                  type="number"
                  min={0}
                  max={36}
                  value={decimals}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (!Number.isFinite(next)) return;
                    setDecimals(Math.max(0, Math.min(36, Math.trunc(next))));
                  }}
                  readOnly={decimalsLocked}
                />
              </div>
            </div>

            <div className="dx-field">
              <span className="dx-label">Recipient</span>
              <input placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>

            <div className="dx-field">
              <span className="dx-label">Amount</span>
              <input placeholder="e.g. 1.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <div className="dx-help">We convert to raw units automatically.</div>
            </div>

            <div className="dx-field">
              <span className="dx-label">Name (optional)</span>
              <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>

            <div className="dx-field">
              <span className="dx-label">Message (optional)</span>
              <textarea
                placeholder="Add a message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                style={{ minHeight: 96 }}
              />
            </div>

            <div className="dx-field">
              <span className="dx-label">Reason (optional)</span>
              <input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>

            <div className="dx-field">
              <span className="dx-label">Note (optional)</span>
              <textarea
                placeholder="Private note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ minHeight: 96 }}
              />
            </div>

            <div className="dx-row2">
              <label className="dx-field">
                <span className="dx-label">Speed</span>
                <select value={speed} onChange={(e) => setSpeed(e.target.value === "1" ? 1 : 0)}>
                  <option value={0}>Eco</option>
                  <option value={1}>Instant</option>
                </select>
              </label>

              <label className="dx-field">
                <span className="dx-label">Mode</span>
                <select value={mode} onChange={(e) => setMode(e.target.value as "SPONSORED" | "SELF_PAY")}>
                  <option value="SPONSORED">SPONSORED</option>
                  <option value="SELF_PAY">SELF_PAY</option>
                </select>
              </label>
            </div>

            <div className="dx-actions">
              <button className="dx-primary" type="submit" disabled={loading || !isConnected || !quote}>
                {loading ? "Sending…" : "Send"}
              </button>
            </div>

            {!isConnected ? <div className="dx-alert">Connect wallet first.</div> : null}
          </form>
        </div>
      </section>

      {/* RIGHT: ACTIVITY / STATUS / QUOTE */}
      <aside className="dx-stack">
        <section className="dx-card">
          <div className="dx-card-in">
            <div className="dx-card-head">
              <h2 className="dx-card-title">Activity</h2>
              <p className="dx-card-hint">Live</p>
            </div>

            {quoteBusy ? <div className="dx-muted">Quote: loading…</div> : null}
            {status ? <div className="dx-muted" style={{ marginTop: 8 }}>{status}</div> : null}

            {loading ? (
              <div style={{ marginTop: 12 }}>
                <div className="dx-muted" style={{ marginBottom: 10 }}>
                  {mode === "SPONSORED"
                    ? "First-time send may show extra wallet popups."
                    : "You’ll confirm a normal wallet transfer."}
                </div>

                <ol className="dx-steps">
                  {mode === "SELF_PAY" ? (
                    <li className={phase === "send" ? "dx-step-active" : ""}>Confirm wallet transfer</li>
                  ) : (
                    <>
                      {Array.isArray(quote?.setupNeeded) &&
                      quote?.setupNeeded?.includes("permit2_allowance_missing") ? (
                        <li className={phase === "approve" ? "dx-step-active" : ""}>Approve token for Permit2</li>
                      ) : null}

                      {String(quote?.lane ?? "").toUpperCase() === "PERMIT2" ? (
                        <li className={phase === "permit2" ? "dx-step-active" : ""}>Sign Permit2 authorization</li>
                      ) : null}

                      {String(quote?.lane ?? "").toUpperCase() === "EIP3009" ? (
                        <li className={phase === "eip3009" ? "dx-step-active" : ""}>Sign EIP-3009 authorization</li>
                      ) : null}

                      {String(quote?.lane ?? "").toUpperCase() === "EIP2612" ? (
                        <li className={phase === "eip2612" ? "dx-step-active" : ""}>Sign EIP-2612 permit</li>
                      ) : null}

                      <li className={phase === "userop" ? "dx-step-active" : ""}>Sign send request</li>
                      <li className={phase === "send" ? "dx-step-active" : ""}>Sending transaction</li>
                    </>
                  )}
                </ol>
              </div>
            ) : null}

            {quoteError ? <div className="dx-alert dx-alert-danger" style={{ marginTop: 10 }}>{quoteError}</div> : null}
            {error ? <div className="dx-alert dx-alert-danger" style={{ marginTop: 10 }}>{error}</div> : null}
          </div>
        </section>

        {quote ? (
          <section className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-head">
                <h2 className="dx-card-title">Quote</h2>
                <p className="dx-card-hint">Breakdown</p>
              </div>

              <div style={{ display: "grid", gap: 8, fontSize: 13, color: "rgba(255,255,255,0.82)" }}>
                <div><strong style={{ color: "rgba(255,255,255,0.92)" }}>Lane:</strong> {quote.lane ?? "—"}</div>
                <div><strong style={{ color: "rgba(255,255,255,0.92)" }}>Sponsored:</strong> {quote.sponsored ? "Yes" : "No"}</div>

                <div className="dx-divider" />

                <div>
                  <strong style={{ color: "rgba(255,255,255,0.92)" }}>Fee USD (total):</strong>{" "}
                  {`$${(Number(quote.feeUsd6 ?? 0) / 1e6).toFixed(6)}`}
                </div>

                <div>
                  <strong style={{ color: "rgba(255,255,255,0.92)" }}>Fee token amount:</strong>{" "}
                  {quote.feeTokenAmount ? ethers.formatUnits(quote.feeTokenAmount, decimals) : "0"}
                </div>

                <div>
                  <strong style={{ color: "rgba(255,255,255,0.92)" }}>Net token:</strong>{" "}
                  {quote.netAmount || quote.netAmountRaw
                    ? ethers.formatUnits(quote.netAmountRaw ?? quote.netAmount, decimals)
                    : "0"}
                </div>
              </div>

              <div className="dx-divider" />

              <details>
                <summary>Raw details</summary>
                <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.56)", display: "grid", gap: 6 }}>
                  <div>feeUsd6: {quote.feeUsd6 ?? "0"}</div>
                  <div>feeTokenAmount: {quote.feeTokenAmount ?? "0"}</div>
                  <div>netAmount: {quote.netAmountRaw ?? quote.netAmount ?? "0"}</div>
                  <div>feeMode: {quote.feeMode ?? "—"}</div>
                  <div>speed: {quote.speed ?? "—"}</div>
                </div>
              </details>
            </div>
          </section>
        ) : null}
      </aside>
    </div>

    {receipt ? (
      <div style={{ marginTop: 14 }}>
        <ReceiptCard receipt={receipt} />
      </div>
    ) : null}
  </main>
);


}
