import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useSignTypedData } from "wagmi";
import { ethers } from "ethers";
import { acklinkCreate, acklinkQuote } from "../../lib/api";
import { logAppEvent } from "../../lib/appEvents";

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
  const [code, setCode] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [balanceError, setBalanceError] = useState("");
  const [result, setResult] = useState<CreateResult | null>(null);
  const [feeQuoteUsdc6, setFeeQuoteUsdc6] = useState<bigint | null>(null);
  const [quoteVault, setQuoteVault] = useState<string | null>(null);

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
        const vaultFromQuote = String(quote?.acklinkVault ?? "").trim();
        setQuoteVault(vaultFromQuote && ethers.isAddress(vaultFromQuote) ? vaultFromQuote : null);
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

  const copy = async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
    } catch {
      // ignore
    }
  };

  const generateCode = () => {
    try {
      const bytes = new Uint8Array(4);
      window.crypto?.getRandomValues(bytes);
      const num =
        ((bytes[0] << 24) >>> 0) + ((bytes[1] << 16) >>> 0) + ((bytes[2] << 8) >>> 0) + (bytes[3] >>> 0);
      const codeValue = String(num % 1000000).padStart(6, "0");
      setCode(codeValue);
    } catch {
      const codeValue = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
      setCode(codeValue);
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
    const resolvedVault = quoteVault && ethers.isAddress(quoteVault) ? quoteVault : ACKLINK_VAULT_ADDRESS;
    if (!resolvedVault || !ethers.isAddress(resolvedVault)) {
      setError("Missing AckLink vault address.");
      return;
    }
    if (!code.trim() || code.trim().length < 4 || code.trim().length > 64) {
      setError("Enter a 4-64 character security code.");
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
        void logAppEvent("acklink_quote_success", {
          address,
          chainId: CHAIN_ID,
          meta: {
            amountUsdc6: amountRaw.toString(),
            speed,
          },
        });
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
          to: resolvedVault,
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
        code: code.trim(),
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

      setResult({
        linkId: data?.linkId,
        receiptId: data?.receiptId,
        txHash: data?.txHash,
        expiresAt: data?.expiresAt,
      });
      void logAppEvent("acklink_create_success", {
        address,
        chainId: CHAIN_ID,
        meta: {
          linkId: data?.linkId ?? null,
          receiptId: data?.receiptId ?? null,
          txHash: data?.txHash ?? null,
          amountUsdc6: amountRaw.toString(),
          speed,
        },
      });
    } catch (err: any) {
      setError(err?.message || "Failed to create AckLink");
      void logAppEvent("acklink_create_error", {
        address,
        chainId: CHAIN_ID,
        meta: {
          amountUsdc6: amountRaw?.toString?.() ?? null,
          speed,
          message: String(err?.message || "acklink_create_failed"),
        },
      });
    } finally {
      setLoading(false);
    }
  };

  const shareUrl = result?.linkId ? `${window.location.origin}/ack/${result.linkId}` : "";

 return (
  <main className="dx-container">
    <header>
      <div className="dx-kicker">DENDRITES</div>
      <h1 className="dx-h1">AckLink</h1>
      <p className="dx-sub">
        Create a sponsored USDC link. Share the URL + code separately. Fee is not refundable.
      </p>
    </header>

    <div className="dx-grid" style={{ gridTemplateColumns: "1.05fr 0.95fr" }}>
      {/* LEFT: CREATE FORM */}
      <section className="dx-card">
        <div className="dx-card-in">
          <div className="dx-card-head">
            <h2 className="dx-card-title">Create</h2>
            <p className="dx-card-hint">USDC • Base Sepolia</p>
          </div>

          <form
            className="dx-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleCreate();
            }}
          >
            <div className="dx-row2">
              <label className="dx-field">
                <span className="dx-label">Amount (USDC)</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="10.00"
                />
                <div className="dx-help">
                  Total charged = amount + fee. Balance check updates automatically.
                </div>
              </label>

              <div className="dx-field">
                <span className="dx-label">Speed</span>

                <div className="dx-radioRow">
                  <label className={`dx-radio ${speed === "eco" ? "dx-radioOn" : ""}`}>
                    <input
                      type="radio"
                      checked={speed === "eco"}
                      onChange={() => setSpeed("eco")}
                    />
                    <span className="dx-radioText">Eco</span>
                    <span className="dx-pill dx-pillBlue">$0.20</span>
                  </label>

                  <label className={`dx-radio ${speed === "instant" ? "dx-radioOn" : ""}`}>
                    <input
                      type="radio"
                      checked={speed === "instant"}
                      onChange={() => setSpeed("instant")}
                    />
                    <span className="dx-radioText">Instant</span>
                    <span className="dx-pill dx-pillBlue">$0.30</span>
                  </label>
                </div>

                <div className="dx-help">
                  Live fee quote may override the fixed label.
                </div>
              </div>
            </div>

            <div className="dx-field">
              <span className="dx-label">Security code (required)</span>

              <div className="dx-codeRow">
                <input
                  className="dx-mono"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Enter or generate a code"
                />
                <button type="button" className="dx-miniBtn" onClick={generateCode}>
                  Generate
                </button>
              </div>

              <div className="dx-alert dx-alert-warn" style={{ marginTop: 10 }}>
                Share this code separately. The recipient must enter it to claim.
              </div>
            </div>

            <div className="dx-field">
              <span className="dx-label">Name (optional)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sender name" />
            </div>

            <div className="dx-field">
              <span className="dx-label">Message (optional)</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Public message"
                style={{ minHeight: 96 }}
              />
            </div>

            <div className="dx-field">
              <span className="dx-label">Reason (optional)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
            </div>

            <div className="dx-field">
              <span className="dx-label">Private note (optional)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Saved privately after receipt is created"
                style={{ minHeight: 84 }}
              />
            </div>

            {balanceError ? (
              <div className="dx-alert dx-alert-danger">{balanceError}</div>
            ) : null}

            {error ? <div className="dx-alert dx-alert-danger">{error}</div> : null}

            <div className="dx-actions">
              <button
                className="dx-primary"
                type="submit"
                disabled={loading || !isConnected || Boolean(balanceError)}
              >
                {loading ? "Creating…" : "Create link"}
              </button>

              {!isConnected ? (
                <div className="dx-alert" style={{ marginTop: 0 }}>
                  Connect wallet first.
                </div>
              ) : null}
            </div>
          </form>
        </div>
      </section>

      {/* RIGHT: SUMMARY / RESULT */}
      <aside className="dx-stack">
        <section className="dx-card">
          <div className="dx-card-in">
            <div className="dx-card-head">
              <h2 className="dx-card-title">Summary</h2>
              <p className="dx-card-hint">Live</p>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div className="dx-rowInline">
                <span className="dx-pill dx-pillBlue">Chain</span>
                <span className="dx-muted">Base Sepolia ({CHAIN_ID})</span>
              </div>

              <div className="dx-rowInline">
                <span className="dx-pill">Token</span>
                <span className="dx-muted dx-mono">
                  {USDC_ADDRESS && USDC_ADDRESS.startsWith("0x") ? USDC_ADDRESS : "USDC not configured"}
                </span>
              </div>

              <div className="dx-divider" />

              <div className="dx-kv">
                <div className="dx-k">Amount</div>
                <div className="dx-v">{amount?.trim() ? `${amount} USDC` : "—"}</div>

                <div className="dx-k">Fee (USDC)</div>
                <div className="dx-v">
                  {feeQuoteUsdc6 != null
                    ? `${ethers.formatUnits(feeQuoteUsdc6, DECIMALS)} USDC`
                    : `${ethers.formatUnits(feeUsdc6, DECIMALS)} USDC`}
                </div>

                <div className="dx-k">Total charged</div>
                <div className="dx-v">
                  {totalRaw != null ? `${ethers.formatUnits(totalRaw, DECIMALS)} USDC` : "—"}
                </div>

                <div className="dx-k">Vault</div>
                <div className="dx-v dx-mono">
                  {(quoteVault && ethers.isAddress(quoteVault) ? quoteVault : ACKLINK_VAULT_ADDRESS) || "—"}
                </div>
              </div>

              {balanceError ? <div className="dx-alert dx-alert-danger">{balanceError}</div> : null}
            </div>
          </div>
        </section>

        {result?.linkId ? (
          <section className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-head">
                <h2 className="dx-card-title">Created</h2>
                <p className="dx-card-hint">Share</p>
              </div>

              <div className="dx-section">
                <div className="dx-kv">
                  <div className="dx-k">Security code</div>
                  <div className="dx-v dx-mono">{code}</div>

                  <div className="dx-k">Share URL</div>
                  <div className="dx-v dx-mono">{shareUrl}</div>
                </div>

                <div className="dx-btnRow" style={{ marginTop: 12 }}>
                  <button className="dx-copyBtn" onClick={() => copy(code)}>
                    Copy code
                  </button>
                  <button className="dx-copyBtn" onClick={() => copy(shareUrl)}>
                    Copy link
                  </button>

                  {result?.receiptId ? (
                    <a className="dx-linkBtn" href={`/receipts/${result.receiptId}`} target="_blank" rel="noreferrer">
                      View receipt
                    </a>
                  ) : null}
                </div>

                {result?.expiresAt ? (
                  <div className="dx-muted" style={{ marginTop: 10 }}>
                    Expires: {new Date(result.expiresAt).toLocaleString()} (fee not refundable)
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}
      </aside>
    </div>
  </main>
);

}
