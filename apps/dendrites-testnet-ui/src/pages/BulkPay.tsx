import { useMemo, useState } from "react";
import { useAccount, usePublicClient, useSignTypedData } from "wagmi";
import { ethers } from "ethers";
import { qpUrl } from "../lib/quickpayApiBase";
import { getQuickPayChainConfig } from "../lib/quickpayChainConfig";

const USDC_DEFAULT = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DECIMALS = 6;

function parseLine(line: string) {
  const parts = line
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return { address: parts[0], amount: parts[1] };
}

export default function BulkPay() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: 84532 });
  const { signTypedDataAsync } = useSignTypedData();
  const [speed, setSpeed] = useState<0 | 1>(1);
  const [recipientsInput, setRecipientsInput] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);
  const [bulkNotConfigured, setBulkNotConfigured] = useState(false);

  const usdcAddress = String(import.meta.env.VITE_USDC_ADDRESS || USDC_DEFAULT).trim();
  const speedLabel = speed === 0 ? "eco" : "instant";

  const parsed = useMemo(() => {
    const lines = recipientsInput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const entries: { address: string; amount: string; amountRaw: string }[] = [];
    const errors: string[] = [];
    let total = 0n;

    lines.forEach((line, idx) => {
      const parsedLine = parseLine(line);
      if (!parsedLine) {
        errors.push(`Line ${idx + 1}: Expected "address,amount"`);
        return;
      }
      const { address: addr, amount } = parsedLine;
      if (!ethers.isAddress(addr)) {
        errors.push(`Line ${idx + 1}: Invalid address`);
        return;
      }
      try {
        const raw = ethers.parseUnits(amount, DECIMALS);
        if (raw <= 0n) {
          errors.push(`Line ${idx + 1}: Amount must be > 0`);
          return;
        }
        total += raw;
        entries.push({ address: ethers.getAddress(addr), amount, amountRaw: raw.toString() });
      } catch {
        errors.push(`Line ${idx + 1}: Invalid amount`);
      }
    });

    return { entries, errors, totalNet: total };
  }, [recipientsInput]);

  const totalNetDisplay = useMemo(() => {
    if (parsed.totalNet <= 0n) return "0";
    return ethers.formatUnits(parsed.totalNet, DECIMALS);
  }, [parsed.totalNet]);

  const fetchQuote = async () => {
    if (!address) {
      setQuoteError("Connect wallet first.");
      return;
    }
    if (!parsed.entries.length || parsed.errors.length) {
      setQuoteError("Fix recipient list errors first.");
      return;
    }
    const to = parsed.entries[0].address;
    const amountRaw = parsed.totalNet.toString();
    setQuoteLoading(true);
    setQuoteError("");
    setQuote(null);
    try {
      const res = await fetch(qpUrl("/quoteBulk"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: 84532,
          from: address,
          token: usdcAddress,
          to,
          amount: amountRaw,
          feeMode: speedLabel,
          speed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503 && data?.code === "BULK_NOT_CONFIGURED") {
        setBulkNotConfigured(true);
        throw new Error("Bulk is not enabled on the API yet. Set ROUTER_BULK/PAYMASTER_BULK in Railway.");
      }
      if (res.status === 400 || data?.ok === false) {
        const details = data?.details ? ` ${JSON.stringify(data.details)}` : "";
        throw new Error(`${data?.error || "Bad request"}${details}`.trim());
      }
      if (!res.ok) throw new Error(data?.error || "Failed to get quote");
      setQuote(data);
    } catch (err: any) {
      setQuoteError(err?.message || "Failed to get quote");
    } finally {
      setQuoteLoading(false);
    }
  };

  const sendBulk = async () => {
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    if (!parsed.entries.length || parsed.errors.length) {
      setError("Fix recipient list errors first.");
      return;
    }
    if (!quote) {
      setError("Get a quote first.");
      return;
    }

    setLoading(true);
    setError("");
    setStatus("");
    setResult(null);
    setBulkNotConfigured(false);

    try {
      const chainId = 84532;
      const routerAddr = String(
        import.meta.env.VITE_ROUTER_BULK ?? quote?.router ?? getQuickPayChainConfig(chainId)?.router ?? ""
      ).trim();
      if (!ethers.isAddress(routerAddr)) {
        throw new Error("Missing router address for EIP3009");
      }
      if (!publicClient) {
        throw new Error("Wallet client unavailable");
      }

      let tokenName = "USD Coin";
      let tokenVersion = "2";
      const eip3009Abi = [
        { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
        { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
      ] as const;
      try {
        tokenName = await publicClient.readContract({
          address: usdcAddress as `0x${string}`,
          abi: eip3009Abi,
          functionName: "name",
        });
      } catch {}
      try {
        tokenVersion = await publicClient.readContract({
          address: usdcAddress as `0x${string}`,
          abi: eip3009Abi,
          functionName: "version",
        });
      } catch {}

      const feeAmountRaw = BigInt(String(quote?.feeTokenAmount || "0"));
      if (feeAmountRaw <= 0n) {
        throw new Error("Invalid fee from quote");
      }
      const totalWithFee = parsed.totalNet + feeAmountRaw;

      const now = Math.floor(Date.now() / 1000);
      const validAfter = now - 10;
      const validBefore = now + 60 * 60;
      const nonce = ethers.hexlify(ethers.randomBytes(32));

      const typedData = {
        domain: {
          name: tokenName,
          version: tokenVersion,
          chainId,
          verifyingContract: usdcAddress as `0x${string}`,
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
          from: address.toLowerCase() as `0x${string}`,
          to: routerAddr as `0x${string}`,
          value: totalWithFee,
          validAfter: BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce: nonce as `0x${string}`,
        },
      } as const;

      setStatus("Waiting for EIP-3009 signature…");
      const signature = await signTypedDataAsync(typedData);
      const auth = {
        type: "EIP3009",
        from: typedData.message.from,
        to: typedData.message.to,
        value: typedData.message.value.toString(),
        validAfter: typedData.message.validAfter.toString(),
        validBefore: typedData.message.validBefore.toString(),
        nonce: typedData.message.nonce,
        signature,
      };

      const sendPayload: any = {
        chainId,
        from: address,
        token: usdcAddress,
        transfers: parsed.entries.map((entry) => ({ to: entry.address, amount: entry.amountRaw })),
        speed,
        auth,
      };
      if (referenceId.trim()) sendPayload.referenceId = referenceId.trim();

      const postSend = async (payload: any) => {
        const res = await fetch(qpUrl("/sendBulk"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 503 && data?.code === "BULK_NOT_CONFIGURED") {
          setBulkNotConfigured(true);
          throw new Error("Bulk is not enabled on the API yet. Set ROUTER_BULK/PAYMASTER_BULK in Railway.");
        }
        if (!res.ok) {
          throw new Error(data?.error || "Bulk send failed");
        }
        return data;
      };

      setStatus("Submitting sponsored bulk userOp…");
      let data = await postSend(sendPayload);
      const needsUserOpSig = data?.needsUserOpSignature === true && /^0x[0-9a-fA-F]{64}$/.test(String(data?.userOpHash || ""));
      if (needsUserOpSig && !sendPayload.userOpSignature) {
        setStatus("Waiting for userOp signature…");
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();
        const sig = await signer.signMessage(ethers.getBytes(data.userOpHash));
        if (!data?.userOpDraft) {
          throw new Error("Missing userOpDraft from server response.");
        }
        setStatus("Submitting signed userOp…");
        data = await postSend({ ...sendPayload, userOpSignature: sig, userOpDraft: data.userOpDraft });
      }

      setResult(data);
      setStatus("Done");
    } catch (err: any) {
      setError(err?.message || "Bulk send failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Bulk Pay (Beta)</h2>
      {bulkNotConfigured ? (
        <div style={{ background: "#2a1d00", border: "1px solid #6a4a00", padding: 12, borderRadius: 6 }}>
          Bulk is not enabled on the API yet. Set ROUTER_BULK/PAYMASTER_BULK in Railway.
        </div>
      ) : null}
      <p style={{ maxWidth: 680 }}>
        USDC only. Enter one recipient per line using address and amount. Example:
        <br />
        <code>0xabc... 12.34</code>
      </p>

      <div style={{ display: "grid", gap: 12, maxWidth: 720 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Recipients (address, amount)</span>
          <textarea
            rows={8}
            value={recipientsInput}
            onChange={(e) => setRecipientsInput(e.target.value)}
            placeholder={`0xabc... 12.34\n0xdef... 5.00`}
            style={{ fontFamily: "monospace" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Reference ID (optional, 32-byte hex)</span>
          <input
            value={referenceId}
            onChange={(e) => setReferenceId(e.target.value)}
            placeholder="0x..."
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Speed</span>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value) as 0 | 1)}>
            <option value={0}>eco</option>
            <option value={1}>instant</option>
          </select>
        </label>

        <div style={{ display: "grid", gap: 4 }}>
          <div>Total recipients: {parsed.entries.length}</div>
          <div>Total amount: {totalNetDisplay} USDC</div>
          {quote?.feeTokenAmount ? (
            <div>
              Fee: {ethers.formatUnits(BigInt(String(quote.feeTokenAmount)), DECIMALS)} USDC
            </div>
          ) : null}
        </div>

        {parsed.errors.length ? (
          <div style={{ color: "tomato" }}>
            {parsed.errors.map((msg, idx) => (
              <div key={`${msg}-${idx}`}>{msg}</div>
            ))}
          </div>
        ) : null}

        {quoteError ? <div style={{ color: "tomato" }}>{quoteError}</div> : null}
        {error ? <div style={{ color: "tomato" }}>{error}</div> : null}
        {status ? <div>{status}</div> : null}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={fetchQuote} disabled={!isConnected || quoteLoading || loading}>
            {quoteLoading ? "Quoting…" : "Get Quote"}
          </button>
          <button onClick={sendBulk} disabled={!isConnected || loading}>
            {loading ? "Sending…" : "Send Bulk"}
          </button>
        </div>

        {result ? (
          <div style={{ background: "#111", padding: 12, borderRadius: 6 }}>
            <div>Request ID: {result.reqId || "-"}</div>
            {result.userOpHash ? (
              <div>
                UserOp Hash: {" "}
                <a
                  href={`https://sepolia.basescan.org/tx/${result.userOpHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {result.userOpHash}
                </a>
              </div>
            ) : (
              <div>UserOp Hash: -</div>
            )}
            {result.txHash ? (
              <div>
                Tx Hash: {" "}
                <a href={`https://sepolia.basescan.org/tx/${result.txHash}`} target="_blank" rel="noreferrer">
                  {result.txHash}
                </a>
              </div>
            ) : (
              <div>Tx Hash: -</div>
            )}
            <div>Recipients: {parsed.entries.length}</div>
            <div>
              Fee: {result.feeAmountRaw ? ethers.formatUnits(BigInt(String(result.feeAmountRaw)), DECIMALS) : "-"} USDC
            </div>
            <div>
              Total: {result.netAmountRaw
                ? ethers.formatUnits(
                    BigInt(String(result.netAmountRaw)) + BigInt(String(result.feeAmountRaw || 0)),
                    DECIMALS
                  )
                : "-"} USDC
            </div>
            <div>Reference ID: {result.referenceId || referenceId || "-"}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
