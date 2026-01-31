import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useSignTypedData } from "wagmi";
import { ethers } from "ethers";
import { acklinkCreate, acklinkQuote, quickpayNoteSet } from "../../lib/api";

const CHAIN_ID = 84532;
const DECIMALS = 6;
const USDC_ADDRESS = String(import.meta.env.VITE_USDC_ADDRESS ?? import.meta.env.VITE_USDC ?? "").trim();
const ACKLINK_VAULT_ADDRESS = String(
  import.meta.env.VITE_ACKLINK_VAULT ?? import.meta.env.VITE_ACKLINK ?? ""
).trim();

type CreateResult = {
  linkId?: string;
  receiptId?: string;
  txHash?: string;
  expiresAt?: string;
};

export default function AckLinkCreate() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();

  const [amount, setAmount] = useState("");
  const [speed, setSpeed] = useState<"eco" | "instant">("eco");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [balanceError, setBalanceError] = useState("");
  const [result, setResult] = useState<CreateResult | null>(null);
  const [feeQuoteUsdc6, setFeeQuoteUsdc6] = useState<bigint | null>(null);

  const feeUsdc6 = speed === "eco" ? 200000n : 300000n;

  const amountRaw = useMemo(() => {
    try {
      if (!amount.trim()) return 0n;
      return ethers.parseUnits(amount.trim(), DECIMALS);
    } catch {
      return null;
    }
  }, [amount]);

  const totalRaw = amountRaw != null ? amountRaw + (feeQuoteUsdc6 ?? feeUsdc6) : null;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!address || amountRaw == null || amountRaw <= 0n) {
        setFeeQuoteUsdc6(null);
        return;
      }
      try {
        const quote = await acklinkQuote({
          from: address,
          amountUsdc6: amountRaw.toString(),
          speed,
        });
        if (cancelled) return;
        const fee = BigInt(quote?.feeUsdc6 ?? feeUsdc6);
        setFeeQuoteUsdc6(fee);
      } catch {
        if (!cancelled) setFeeQuoteUsdc6(null);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [address, amountRaw, speed, feeUsdc6]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!address || !publicClient || !USDC_ADDRESS) {
        setBalanceError("");
        return;
      }
      if (amountRaw == null) {
        setBalanceError("Enter a valid amount.");
        return;
      }
      if (amountRaw <= 0n) {
        setBalanceError("");
        return;
      }
      try {
        const balance = await publicClient.readContract({
          address: USDC_ADDRESS as `0x${string}`,
          abi: [
            {
              type: "function",
              name: "balanceOf",
              stateMutability: "view",
              inputs: [{ name: "owner", type: "address" }],
              outputs: [{ type: "uint256" }],
            },
          ],
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        });
        if (cancelled) return;
        if (balance < (totalRaw ?? 0n)) {
          const need = ethers.formatUnits(totalRaw ?? 0n, DECIMALS);
          const have = ethers.formatUnits(balance, DECIMALS);
          setBalanceError(`Insufficient USDC. Need ${need}, have ${have}.`);
        } else {
          setBalanceError("");
        }
      } catch {
        if (!cancelled) setBalanceError("Failed to check balance.");
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [address, amountRaw, publicClient, totalRaw]);

  const buildNoteMessage = (receiptIdValue: string, senderLower: string) =>
    `Dendrites QuickPay Note v1\nAction: SET\nReceipt: ${receiptIdValue}\nSender: ${senderLower}\nChainId: ${CHAIN_ID}`;

  const copy = async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
    } catch {
      // ignore
    }
  };

  const handleCreate = async () => {
    if (!isConnected || !address) {
      setError("Connect wallet first.");
      return;
    }
    if (amountRaw == null || amountRaw <= 0n) {
      setError("Enter a valid amount.");
      return;
    }
    if (balanceError) {
      setError(balanceError);
      return;
    }
    if (!USDC_ADDRESS || !ethers.isAddress(USDC_ADDRESS)) {
      setError("Missing USDC address.");
      return;
    }
    if (!ACKLINK_VAULT_ADDRESS || !ethers.isAddress(ACKLINK_VAULT_ADDRESS)) {
      setError("Missing AckLink vault address.");
      return;
    }
    if (!signTypedDataAsync) {
      setError("Wallet does not support typed-data signing.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const senderLower = address.toLowerCase();
      let feeToUse = feeQuoteUsdc6;
      if (feeToUse == null) {
        const quote = await acklinkQuote({
          from: address,
          amountUsdc6: amountRaw.toString(),
          speed,
        });
        feeToUse = BigInt(quote?.feeUsdc6 ?? feeUsdc6);
        setFeeQuoteUsdc6(feeToUse);
      }
      const totalUsdc6 = (amountRaw ?? 0n) + (feeToUse ?? feeUsdc6);
      const eip3009Abi = [
        { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
        { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
      ] as const;
      let tokenName = "USD Coin";
      let tokenVersion = "2";
      if (publicClient) {
        try {
          tokenName = await publicClient.readContract({
            address: USDC_ADDRESS as `0x${string}`,
            abi: eip3009Abi,
            functionName: "name",
          });
        } catch {}
        try {
          tokenVersion = await publicClient.readContract({
            address: USDC_ADDRESS as `0x${string}`,
            abi: eip3009Abi,
            functionName: "version",
          });
        } catch {}
      }

      const now = Math.floor(Date.now() / 1000);
      const validAfter = now - 10;
      const validBefore = now + 60 * 60;
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const typedData = {
        domain: {
          name: tokenName,
          version: tokenVersion,
          chainId: CHAIN_ID,
          verifyingContract: USDC_ADDRESS,
        },
        types: {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        message: {
          from: senderLower,
          to: ACKLINK_VAULT_ADDRESS,
          value: totalUsdc6,
          validAfter: BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce,
        },
      } as const;

      const signature = await signTypedDataAsync(typedData);
      const split = ethers.Signature.from(signature);

      const payloadBase = {
        from: address,
        amountUsdc6: amountRaw.toString(),
        speed,
        auth: {
          from: senderLower,
          value: totalUsdc6.toString(),
          validAfter: String(validAfter),
          validBefore: String(validBefore),
          nonce,
          v: split.v,
          r: split.r,
          s: split.s,
        },
        name: name.trim() || null,
        message: message.trim() || null,
        reason: reason.trim() || null,
        note: note.trim() || null,
      };

      let data = await acklinkCreate(payloadBase);

      const needsUserOpSig =
        data?.needsUserOpSignature === true && /^0x[0-9a-fA-F]{64}$/.test(String(data?.userOpHash || ""));

      if (needsUserOpSig) {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();
        const sig = await signer.signMessage(ethers.getBytes(data.userOpHash));
        data = await acklinkCreate({
          ...payloadBase,
          userOpSignature: sig,
          userOpDraft: data.userOpDraft,
        });
      }

      if (!data?.ok && data?.code) {
        throw new Error(data.code);
      }

      const receiptId = String(data?.receiptId || "");

      if (note.trim() && receiptId) {
        try {
          const provider = new ethers.BrowserProvider((window as any).ethereum);
          const signer = await provider.getSigner();
          const signature = await signer.signMessage(buildNoteMessage(receiptId, senderLower));
          await quickpayNoteSet({
            receiptId,
            sender: senderLower,
            note: note.trim(),
            signature,
            chainId: CHAIN_ID,
          });
        } catch {
          // ignore note failure
        }
      }

      setResult({
        linkId: data?.linkId,
        receiptId: data?.receiptId,
        txHash: data?.txHash,
        expiresAt: data?.expiresAt,
      });
    } catch (err: any) {
      setError(err?.message || "Failed to create AckLink");
    } finally {
      setLoading(false);
    }
  };

  const shareUrl = result?.linkId ? `${window.location.origin}/ack/${result.linkId}` : "";

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <h2>AckLink</h2>
      <p>Create a sponsored USDC link. Fee is not refundable.</p>

      <div style={{ display: "grid", gap: 12 }}>
        <label>
          Amount (USDC)
          <input
            style={{ width: "100%", padding: 8, marginTop: 4 }}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="10.00"
          />
        </label>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <label>
            <input
              type="radio"
              checked={speed === "eco"}
              onChange={() => setSpeed("eco")}
            />
            Eco ($0.20)
          </label>
          <label>
            <input
              type="radio"
              checked={speed === "instant"}
              onChange={() => setSpeed("instant")}
            />
            Instant ($0.30)
          </label>
        </div>

        <label>
          Name (optional)
          <input
            style={{ width: "100%", padding: 8, marginTop: 4 }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sender name"
          />
        </label>

        <label>
          Message (optional)
          <textarea
            style={{ width: "100%", padding: 8, marginTop: 4, minHeight: 80 }}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Public message"
          />
        </label>

        <label>
          Reason (optional)
          <input
            style={{ width: "100%", padding: 8, marginTop: 4 }}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason"
          />
        </label>

        <label>
          Private note (optional)
          <textarea
            style={{ width: "100%", padding: 8, marginTop: 4, minHeight: 70 }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Saved privately after receipt is created"
          />
        </label>

        {balanceError ? <div style={{ color: "#f88" }}>{balanceError}</div> : null}
        {error ? <div style={{ color: "#f88" }}>{error}</div> : null}

        <button
          onClick={handleCreate}
          disabled={loading || !isConnected || Boolean(balanceError)}
          style={{ padding: "10px 14px", borderRadius: 6, border: "1px solid #333" }}
        >
          {loading ? "Creating..." : "Create link"}
        </button>
      </div>

      {result?.linkId ? (
        <div style={{ marginTop: 24, padding: 16, border: "1px solid #333", borderRadius: 8 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>Share URL:</strong> {shareUrl}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => copy(shareUrl)}>Copy link</button>
            {result?.receiptId ? (
              <a href={`/receipts/${result.receiptId}`} target="_blank" rel="noreferrer">
                View receipt
              </a>
            ) : null}
          </div>
          {result?.expiresAt ? (
            <div style={{ marginTop: 12, color: "#bbb" }}>
              Expires: {new Date(result.expiresAt).toLocaleString()} (fee not refundable)
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
