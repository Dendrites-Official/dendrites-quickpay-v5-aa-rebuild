import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { qpUrl } from "../lib/quickpayApiBase";
import { addTokenToWallet } from "../utils/wallet";
import { ethers } from "ethers";

const DEFAULT_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TODO_MDNDX = "<TODO_MDNDX_ADDRESS>";

export default function Faucet() {
  const { address, isConnected, chainId } = useAccount();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [config, setConfig] = useState<any>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState("");
  const [verifyStatus, setVerifyStatus] = useState<"idle" | "verified" | "not_found">("idle");
  const [txHash, setTxHash] = useState("");

  const usdcAddress = String(config?.usdc?.address ?? import.meta.env.VITE_USDC_ADDRESS ?? DEFAULT_USDC).trim();
  const mdndxAddress = String(config?.mdndx?.address ?? import.meta.env.VITE_MDNDX_ADDRESS ?? TODO_MDNDX).trim();
  const mdndxReady = Boolean(config?.mdndxConfigured !== false && mdndxAddress && mdndxAddress !== TODO_MDNDX);
  const mdndxDripLabel = String(config?.mdndx?.dripAmount ?? "20");

  const statusAddress = isConnected && address ? address : "Not connected";
  const statusChain = chainId ? String(chainId) : "Not available";

  const canVerify = Boolean(isConnected && address && mdndxReady && email.trim());
  const canClaim = Boolean(isConnected && address && mdndxReady && email.trim() && verifyStatus === "verified");

  useEffect(() => {
    const loadConfig = async () => {
      setConfigLoading(true);
      setConfigError("");
      try {
        const res = await fetch(qpUrl("/faucet/config"));
        const data = await res.json();
        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || "Failed to load config");
        }
        setConfig(data);
      } catch (err: any) {
        setConfigError(err?.message || "Failed to load faucet config.");
      } finally {
        setConfigLoading(false);
      }
    };
    loadConfig();
  }, []);

  useEffect(() => {
    setVerifyStatus("idle");
    setTxHash("");
  }, [email, address]);

  const postJson = async (path: string, body: any) => {
    const res = await fetch(qpUrl(path), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      const err: any = new Error(data?.error || "Request failed");
      err.status = res.status;
      err.code = data?.error || data?.code;
      err.details = data;
      throw err;
    }
    return data;
  };

  const handleAddToken = async (token: { address: string; symbol: string; decimals: number }) => {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const added = await addTokenToWallet(token);
      if (added) {
        setSuccess(`Added ${token.symbol} to wallet.`);
      } else {
        setError("Token add request was rejected.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to add token.");
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async () => {
    setError("");
    setSuccess("");
    setTxHash("");
    if (!isConnected || !address) {
      setError("Connect your wallet to claim mDNDX.");
      return;
    }
    if (!email.trim()) {
      setError("Email is required for waitlist verification.");
      return;
    }
    if (!mdndxReady) {
      setError("mDNDX contract address is not configured yet.");
      return;
    }
    if (verifyStatus !== "verified") {
      setError("Verify your waitlist status first.");
      return;
    }
    setLoading(true);
    try {
      const challenge = await postJson("/faucet/mdndx/challenge", {
        email: email.trim(),
        address,
      });
      const messageToSign = String(challenge?.messageToSign ?? "");
      const challengeId = String(challenge?.challengeId ?? "");
      if (!messageToSign || !challengeId) {
        throw new Error("Challenge response invalid");
      }

      let signature = "";
      const ethereum = (window as any)?.ethereum;
      if (ethereum) {
        try {
          const provider = new ethers.BrowserProvider(ethereum);
          const signer = await provider.getSigner();
          signature = await signer.signMessage(messageToSign);
        } catch {
          signature = await ethereum.request({
            method: "personal_sign",
            params: [messageToSign, address],
          });
        }
      }
      if (!signature) {
        throw new Error("Signature failed");
      }

      const claim = await postJson("/faucet/mdndx/claim", {
        email: email.trim(),
        address,
        challengeId,
        signature,
      });
      if (claim?.txHash) setTxHash(String(claim.txHash));
      setSuccess("Claim submitted successfully.");
    } catch (err: any) {
      const code = err?.code || err?.details?.error;
      if (code === "NOT_WAITLISTED") {
        setError("Not on waitlist. Join at waitlist.dendrites.ai, then Verify again.");
      } else if (code === "COOLDOWN") {
        const nextAt = err?.details?.nextEligibleAt;
        setError(`Try again at ${nextAt || "later"}.`);
      } else if (code === "HARD_CAP") {
        setError("Claim limit reached (3 total). Try another wallet.");
      } else if (code === "INSUFFICIENT_FAUCET_INVENTORY") {
        setError("Faucet inventory low. Try later.");
      } else if (err?.message === "SERVER_ERROR" && err?.details?.details) {
        setError(String(err.details.details));
      } else {
        setError(err?.message || "Claim failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setError("");
    setSuccess("");
    setTxHash("");
    if (!canVerify) {
      setError("Connect your wallet and enter email to verify.");
      return;
    }
    setLoading(true);
    try {
      const result = await postJson("/faucet/mdndx/verify", {
        email: email.trim(),
        address,
      });
      if (result?.verified) {
        setVerifyStatus("verified");
        setSuccess("✅ Verified");
      } else {
        setVerifyStatus("not_found");
        setError("Not found");
      }
    } catch (err: any) {
      if (err?.message === "SERVER_ERROR" && err?.details?.details) {
        setError(String(err.details.details));
      } else {
        setError(err?.message || "Verify failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (value: string, label: string) => {
    setError("");
    setSuccess("");
    if (!navigator?.clipboard?.writeText) {
      setError("Clipboard not available in this browser.");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setSuccess(`${label} address copied.`);
    } catch (err: any) {
      setError(err?.message || "Failed to copy address.");
    }
  };

  const usdcSteps = useMemo(
    () => [
      "Select Base Sepolia",
      "Select USDC",
      "Paste your wallet address",
      "Claim",
    ],
    []
  );

  return (
    <div style={{ padding: 16 }}>
      <h2>Dendrites Faucet (Base Sepolia)</h2>
      <div style={{ color: "#bdbdbd", marginTop: 6 }}>
        USDC comes from Circle. mDNDX is for Dendrites QuickPay testing (waitlist-only).
      </div>
      <div style={{ marginTop: 10, color: "#d6d6d6" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Why this exists</div>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>USDC is a supported token (EIP-3009 lane) → fully gasless in Sponsored mode.</li>
          <li>mDNDX is for QuickPay testing demos.</li>
        </ul>
      </div>
      <div style={{ marginTop: 10 }}>
        <Link to="/quickpay">Back to QuickPay</Link>
      </div>

      <div style={{ display: "grid", gap: 16, marginTop: 16, maxWidth: 720 }}>
        <div style={{ padding: 16, border: "1px solid #2a2a2a", borderRadius: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>USDC (Circle)</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              onClick={() => window.open("https://faucet.circle.com/", "_blank", "noopener,noreferrer")}
            >
              Open Circle Faucet
            </button>
            <button
              onClick={() => handleAddToken({ address: usdcAddress, symbol: "USDC", decimals: 6 })}
              disabled={loading}
            >
              Add USDC to wallet
            </button>
            <button onClick={() => copyToClipboard(usdcAddress, "USDC")}>Copy USDC address</button>
          </div>
          <ul style={{ marginTop: 12, paddingLeft: 20, color: "#d6d6d6" }}>
            {usdcSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>

        <div style={{ padding: 16, border: "1px solid #2a2a2a", borderRadius: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>mDNDX (Waitlist-only)</div>
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Email</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
                style={{ maxWidth: 360, padding: 8 }}
              />
            </label>
            <div style={{ color: "#bdbdbd" }}>
              Wallet: {statusAddress}
            </div>
            <div style={{ color: "#bdbdbd" }}>
              mDNDX address: {mdndxReady ? mdndxAddress : TODO_MDNDX}
            </div>
            {!mdndxReady ? (
              <div style={{ color: "#ffb74d" }}>
                mDNDX not configured.
              </div>
            ) : null}
            {configLoading ? <div style={{ color: "#bdbdbd" }}>Loading faucet config...</div> : null}
            {configError ? <div style={{ color: "#ff7a7a" }}>{configError}</div> : null}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button onClick={handleVerify} disabled={!canVerify || loading}>
                Verify waitlist status
              </button>
              {verifyStatus === "verified" ? (
                <button onClick={handleClaim} disabled={!canClaim || loading}>
                  Claim {mdndxDripLabel} mDNDX
                </button>
              ) : null}
              <button
                onClick={() => handleAddToken({ address: mdndxAddress, symbol: "mDNDX", decimals: 18 })}
                disabled={!mdndxReady || loading}
              >
                Add mDNDX to wallet
              </button>
              <button
                onClick={() => copyToClipboard(mdndxAddress, "mDNDX")}
                disabled={!mdndxReady}
              >
                Copy mDNDX address
              </button>
            </div>
            {verifyStatus === "verified" ? (
              <div style={{ color: "#7aff9a" }}>✅ Verified</div>
            ) : null}
            {verifyStatus === "not_found" ? (
              <div style={{ color: "#ffb74d" }}>
                Not found. Join the waitlist at{" "}
                <a href="https://waitlist.dendrites.ai" target="_blank" rel="noreferrer">
                  waitlist.dendrites.ai
                </a>
                , then click Verify again.
              </div>
            ) : null}
            {txHash ? (
              <div style={{ color: "#bdbdbd" }}>Tx: {txHash}</div>
            ) : null}
          </div>
        </div>

        <div style={{ padding: 12, border: "1px solid #2a2a2a", borderRadius: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Status</div>
          <div><strong>Connected:</strong> {statusAddress}</div>
          <div><strong>Chain ID:</strong> {statusChain}</div>
          {error ? <div style={{ color: "#ff7a7a", marginTop: 6 }}>{error}</div> : null}
          {success ? <div style={{ color: "#7aff9a", marginTop: 6 }}>{success}</div> : null}
        </div>
      </div>
    </div>
  );
}
