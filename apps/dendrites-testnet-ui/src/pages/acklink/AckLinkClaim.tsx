import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { acklinkGet, acklinkClaim, acklinkRefund, quickpayNoteSet } from "../../lib/api";

const CHAIN_ID = 84532;
const DECIMALS = 6;

type AckLinkData = {
  linkId: string;
  status: string;
  sender: string;
  token: string;
  amountUsdc6: string;
  feeUsdc6: string;
  speed: string;
  expiresAt: string;
  meta?: { name?: string; message?: string; reason?: string } | null;
  claimedTo?: string | null;
  txHashCreate?: string | null;
  txHashClaim?: string | null;
  txHashRefund?: string | null;
};

export default function AckLinkClaim() {
  const { id } = useParams();
  const { address, isConnected } = useAccount();
  const [data, setData] = useState<AckLinkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [actionResult, setActionResult] = useState<{ txHash?: string; receiptId?: string } | null>(null);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const res = await acklinkGet(id);
      setData(res);
    } catch (err: any) {
      setError(err?.message || "Failed to load AckLink");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const expiresAtMs = data?.expiresAt ? new Date(data.expiresAt).getTime() : 0;
  const nowMs = Date.now();
  const isExpired =
    data?.status === "EXPIRED" || (expiresAtMs > 0 && nowMs >= expiresAtMs && data?.status === "CREATED");

  const timeLeft = useMemo(() => {
    if (!expiresAtMs) return "";
    const delta = Math.max(0, expiresAtMs - nowMs);
    const minutes = Math.floor(delta / 60000);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }, [expiresAtMs, nowMs]);

  const amountDisplay = useMemo(() => {
    if (!data?.amountUsdc6) return "";
    try {
      return `${ethers.formatUnits(BigInt(data.amountUsdc6), DECIMALS)} USDC`;
    } catch {
      return data.amountUsdc6;
    }
  }, [data]);

  const shorten = (value: string) => {
    if (!value || value.length < 10) return value;
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  };

  const buildNoteMessage = (receiptIdValue: string, senderLower: string) =>
    `Dendrites QuickPay Note v1\nAction: SET\nReceipt: ${receiptIdValue}\nSender: ${senderLower}\nChainId: ${CHAIN_ID}`;

  const runClaim = async () => {
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    if (!data?.linkId) return;
    setActionLoading(true);
    setError("");
    setActionResult(null);

    try {
      let result = await acklinkClaim({ linkId: data.linkId, claimer: address });
      const needsUserOpSig =
        result?.needsUserOpSignature === true && /^0x[0-9a-fA-F]{64}$/.test(String(result?.userOpHash || ""));
      if (needsUserOpSig) {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();
        const sig = await signer.signMessage(ethers.getBytes(result.userOpHash));
        result = await acklinkClaim({
          linkId: data.linkId,
          claimer: address,
          userOpSignature: sig,
          userOpDraft: result.userOpDraft,
        });
      }

      if (note.trim() && result?.receiptId) {
        try {
          const provider = new ethers.BrowserProvider((window as any).ethereum);
          const signer = await provider.getSigner();
          const signature = await signer.signMessage(buildNoteMessage(result.receiptId, address.toLowerCase()));
          await quickpayNoteSet({
            receiptId: result.receiptId,
            sender: address.toLowerCase(),
            note: note.trim(),
            signature,
            chainId: CHAIN_ID,
          });
        } catch {
          // ignore note failure
        }
      }

      setActionResult({ txHash: result?.txHash, receiptId: result?.receiptId });
      await load();
    } catch (err: any) {
      setError(err?.message || "Claim failed");
    } finally {
      setActionLoading(false);
    }
  };

  const runRefund = async () => {
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    if (!data?.linkId) return;
    setActionLoading(true);
    setError("");
    setActionResult(null);

    try {
      let result = await acklinkRefund({ linkId: data.linkId, requester: address });
      const needsUserOpSig =
        result?.needsUserOpSignature === true && /^0x[0-9a-fA-F]{64}$/.test(String(result?.userOpHash || ""));
      if (needsUserOpSig) {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();
        const sig = await signer.signMessage(ethers.getBytes(result.userOpHash));
        result = await acklinkRefund({
          linkId: data.linkId,
          requester: address,
          userOpSignature: sig,
          userOpDraft: result.userOpDraft,
        });
      }
      setActionResult({ txHash: result?.txHash, receiptId: result?.receiptId });
      await load();
    } catch (err: any) {
      setError(err?.message || "Refund failed");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 760, margin: "0 auto" }}>
      <h2>AckLink</h2>
      {loading ? <div>Loading...</div> : null}
      {error ? <div style={{ color: "#f88", marginBottom: 12 }}>{error}</div> : null}

      {data ? (
        <div style={{ padding: 16, border: "1px solid #333", borderRadius: 8 }}>
          <div><strong>Status:</strong> {isExpired ? "EXPIRED" : data.status}</div>
          <div><strong>Amount:</strong> {amountDisplay}</div>
          <div><strong>Sender:</strong> {shorten(data.sender)}</div>
          {data.meta?.name ? <div><strong>Name:</strong> {data.meta.name}</div> : null}
          {data.meta?.message ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Message</div>
              <div style={{ padding: 10, border: "1px solid #2a2a2a", borderRadius: 6, whiteSpace: "pre-wrap" }}>
                {data.meta.message}
              </div>
            </div>
          ) : null}
          {data.meta?.reason ? <div><strong>Reason:</strong> {data.meta.reason}</div> : null}
          {data.expiresAt ? (
            <div style={{ marginTop: 8, color: "#bbb" }}>
              Expires: {new Date(data.expiresAt).toLocaleString()} {data.status === "CREATED" ? `(${timeLeft} left)` : ""}
            </div>
          ) : null}
        </div>
      ) : null}

      {data && data.status === "CREATED" && !isExpired ? (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          <label>
            Private note (optional)
            <textarea
              style={{ width: "100%", padding: 8, minHeight: 70 }}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Saved privately after receipt is created"
            />
          </label>
          <button
            onClick={runClaim}
            disabled={!isConnected || actionLoading}
            style={{ padding: "10px 14px", borderRadius: 6, border: "1px solid #333" }}
          >
            {actionLoading ? "Claiming..." : "Claim"}
          </button>
        </div>
      ) : null}

      {data && (data.status === "CREATED" || data.status === "EXPIRED") && isExpired ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ color: "#bbb", marginBottom: 8 }}>
            This link has expired. Refund returns funds to the sender.
          </div>
          <button
            onClick={runRefund}
            disabled={!isConnected || actionLoading}
            style={{ padding: "10px 14px", borderRadius: 6, border: "1px solid #333" }}
          >
            {actionLoading ? "Refunding..." : "Refund"}
          </button>
        </div>
      ) : null}

      {actionResult?.txHash || actionResult?.receiptId ? (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #333", borderRadius: 8 }}>
          {actionResult.txHash ? (
            <div>
              <strong>Tx:</strong> {shorten(actionResult.txHash)}
            </div>
          ) : null}
          {actionResult.receiptId ? (
            <a href={`/receipts/${actionResult.receiptId}`} target="_blank" rel="noreferrer">
              View receipt
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
