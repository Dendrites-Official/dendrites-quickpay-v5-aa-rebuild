import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ethers } from "ethers";
import { acklinkGet, acklinkClaim, acklinkRefund } from "../../lib/api";
import { logAppEvent } from "../../lib/appEvents";
import { useAppMode } from "../../demo/AppModeContext";
import { useWalletState } from "../../demo/useWalletState";
import { createDemoReceipt } from "../../demo/demoData";
import { useDemoReceiptsStore } from "../../demo/DemoReceiptsStore";
import type { DemoAckLink } from "../../demo/demoAckLinkStore";
import { useDemoAckLinkStore } from "../../demo/demoAckLinkStore";

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
  const navigate = useNavigate();
  const { isDemo } = useAppMode();
  const { address, isConnected } = useWalletState();
  const { addReceipt } = useDemoReceiptsStore();
  const { getLink, updateLink } = useDemoAckLinkStore();
  const [data, setData] = useState<AckLinkData | null>(null);
  const [demoLink, setDemoLink] = useState<DemoAckLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [actionResult, setActionResult] = useState<{ txHash?: string; receiptId?: string } | null>(null);

  const load = async () => {
    if (!id) return;
    if (isDemo) {
      setLoading(true);
      setError("");
      const link = getLink(id);
      if (!link) {
        setDemoLink(null);
        setData(null);
        setError("Demo link expired — go back and generate again.");
        setLoading(false);
        return;
      }
      setDemoLink(link);
      const expiresAt = new Date(new Date(link.createdAt).getTime() + 1000 * 60 * 60 * 6).toISOString();
      setData({
        linkId: link.id,
        status: link.status.toUpperCase(),
        sender: link.sender,
        token: link.tokenSymbol,
        amountUsdc6: link.amountUsdc6,
        feeUsdc6: link.feeUsdc6,
        speed: "instant",
        expiresAt,
        meta: { name: link.senderName ?? undefined, message: link.message ?? undefined, reason: link.reason ?? undefined },
      });
      setLoading(false);
      return;
    }
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
  }, [id, isDemo]);

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

  const runClaim = async () => {
    if (!address) {
      setError("Connect wallet first.");
      return;
    }
    if (!data?.linkId) return;
    if (!code.trim() || code.trim().length < 4 || code.trim().length > 64) {
      setError("Enter the security code (4-64 characters).");
      return;
    }
    if (isDemo) {
      if (!demoLink) {
        setError("Demo link expired — go back and generate again.");
        return;
      }
      if (demoLink.status === "claimed") {
        setError("This demo link has already been claimed.");
        return;
      }
      if (code.trim() !== demoLink.code) {
        setError("Incorrect code. Ask the sender to re-share the code.");
        return;
      }

      setActionResult(null);
      setError("");
      const feeRaw = BigInt(demoLink.feeUsdc6);
      const amountRaw = BigInt(demoLink.amountUsdc6);
      const netRaw = amountRaw > feeRaw ? amountRaw - feeRaw : 0n;

      const demoReceipt = createDemoReceipt({
        status: "SIMULATED",
        token: demoLink.token,
        token_symbol: demoLink.tokenSymbol,
        token_decimals: demoLink.tokenDecimals,
        amount_raw: demoLink.amountUsdc6,
        fee_amount_raw: demoLink.feeUsdc6,
        net_amount_raw: netRaw.toString(),
        fee_mode: "instant",
        fee_token_mode: "sponsored",
        sender: demoLink.sender,
        owner_eoa: demoLink.sender,
        to: address,
        display_name: demoLink.senderName ?? null,
        title: demoLink.message ?? null,
        reason: demoLink.reason ?? null,
        meta: {
          route: "acklink_claim",
          demoLinkId: demoLink.id,
          kind: "claim",
          status: "Simulated",
        },
      });
      addReceipt(demoReceipt);
      updateLink(demoLink.id, { status: "claimed", claimedTo: address });
      setData((prev) => (prev ? { ...prev, status: "CLAIMED", claimedTo: address } : prev));
      setActionResult({ txHash: demoReceipt.tx_hash, receiptId: demoReceipt.receipt_id });
      navigate(`/receipts/${demoReceipt.receipt_id}`);
      return;
    }
    setActionLoading(true);
    setError("");
    setActionResult(null);

    try {
      let result = await acklinkClaim({ linkId: data.linkId, claimer: address, code: code.trim() });
      const needsUserOpSig =
        result?.needsUserOpSignature === true && /^0x[0-9a-fA-F]{64}$/.test(String(result?.userOpHash || ""));
      if (needsUserOpSig) {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();
        const sig = await signer.signMessage(ethers.getBytes(result.userOpHash));
        result = await acklinkClaim({
          linkId: data.linkId,
          claimer: address,
          code: code.trim(),
          userOpSignature: sig,
          userOpDraft: result.userOpDraft,
        });
      }

      setActionResult({ txHash: result?.txHash, receiptId: result?.receiptId });
      void logAppEvent("acklink_claim_success", {
        address,
        meta: {
          linkId: data?.linkId ?? null,
          receiptId: result?.receiptId ?? null,
          txHash: result?.txHash ?? null,
        },
      });
      await load();
    } catch (err: any) {
      setError(err?.message || "Claim failed");
      void logAppEvent("acklink_claim_error", {
        address,
        meta: {
          linkId: data?.linkId ?? null,
          message: String(err?.message || "acklink_claim_failed"),
        },
      });
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
    if (isDemo) {
      if (!demoLink) {
        setError("Demo link expired — go back and generate again.");
        return;
      }
      setError("");
      const demoReceipt = createDemoReceipt({
        status: "SIMULATED",
        token: demoLink.token,
        token_symbol: demoLink.tokenSymbol,
        token_decimals: demoLink.tokenDecimals,
        amount_raw: demoLink.amountUsdc6,
        fee_amount_raw: "0",
        net_amount_raw: demoLink.amountUsdc6,
        fee_mode: "eco",
        fee_token_mode: "sponsored",
        sender: demoLink.sender,
        owner_eoa: demoLink.sender,
        to: demoLink.sender,
        display_name: demoLink.senderName ?? null,
        title: demoLink.message ?? null,
        reason: demoLink.reason ?? null,
        meta: { route: "acklink_refund", demoLinkId: demoLink.id, kind: "refund", status: "Simulated" },
      });
      addReceipt(demoReceipt);
      updateLink(demoLink.id, { status: "refunded" });
      setData((prev) => (prev ? { ...prev, status: "REFUNDED" } : prev));
      setActionResult({ txHash: demoReceipt.tx_hash, receiptId: demoReceipt.receipt_id });
      return;
    }
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
      void logAppEvent("acklink_refund_success", {
        address,
        meta: {
          linkId: data?.linkId ?? null,
          receiptId: result?.receiptId ?? null,
          txHash: result?.txHash ?? null,
        },
      });
      await load();
    } catch (err: any) {
      setError(err?.message || "Refund failed");
      void logAppEvent("acklink_refund_error", {
        address,
        meta: {
          linkId: data?.linkId ?? null,
          message: String(err?.message || "acklink_refund_failed"),
        },
      });
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
            Security code
            <input
              style={{ width: "100%", padding: 8, marginTop: 4 }}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter the code from the sender"
            />
          </label>
          <button
            onClick={runClaim}
            disabled={!isConnected || actionLoading || (isDemo && data.status !== "CREATED")}
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
