import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useParams } from "react-router-dom";
import { quickpayReceipt } from "../lib/api";
import ReceiptCard from "../components/ReceiptCard";

export default function Receipts() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const initial = id ?? params.get("rid") ?? params.get("uop") ?? params.get("tx") ?? "";
  const [query, setQuery] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<any>(null);

  const trimmed = useMemo(() => query.trim(), [query]);
  const isReceiptId = useMemo(() => trimmed.startsWith("r_"), [trimmed]);
  const isHash = useMemo(() => /^0x[0-9a-fA-F]{64}$/.test(trimmed), [trimmed]);
  const canFetch = useMemo(() => trimmed.length > 0, [trimmed]);

  const shouldPoll = (data: any) => {
    if (!data) return false;
    const status = String(data.status ?? "").toLowerCase();
    if (["finalized", "failed", "complete", "completed", "success"].includes(status)) return false;
    if (data.success !== null && data.success !== undefined) return false;
    return true;
  };

  const buildPayload = (value: string) => {
    const trimmedValue = value.trim();
    if (!trimmedValue) return null;
    if (trimmedValue.startsWith("r_")) return { receiptId: trimmedValue };
    if (/^0x[0-9a-fA-F]{64}$/.test(trimmedValue)) return { userOpHash: trimmedValue };
    return { receiptId: trimmedValue };
  };

  const buildPayloadFromReceipt = (data: any) => {
    const txHash = String(data?.txHash ?? data?.tx_hash ?? "").trim();
    if (txHash) return { txHash };
    const userOpHash = String(data?.userOpHash ?? data?.userop_hash ?? "").trim();
    if (userOpHash) return { userOpHash };
    const receiptId = String(data?.receiptId ?? data?.receipt_id ?? "").trim();
    if (receiptId) return { receiptId };
    return null;
  };

  const fetchReceipt = async () => {
    if (!canFetch) return;
    setLoading(true);
    setError("");
    try {
      const payload = buildPayload(trimmed);
      if (!payload) return;

      let data = await quickpayReceipt(payload);
      if (!data && isHash) {
        data = await quickpayReceipt({ txHash: trimmed });
      }
      setReceipt(data);
      if (!id) {
        setParams((prev) => {
          if (data?.receiptId) {
            prev.set("rid", data.receiptId);
          } else if (isHash) {
            prev.set("uop", trimmed);
          }
          return prev;
        });
      }
    } catch (err: any) {
      setError(err?.message || "Failed to fetch receipt");
    } finally {
      setLoading(false);
    }
  };

  const resyncReceipt = async () => {
    const payload = buildPayloadFromReceipt(receipt) ?? buildPayload(trimmed);
    if (!payload) return;
    try {
      const data = await quickpayReceipt(payload);
      if (data) setReceipt(data);
    } catch {
      // ignore resync errors
    }
  };

  useEffect(() => {
    if (initial) fetchReceipt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!receipt || loading) return undefined;
    if (!shouldPoll(receipt)) return undefined;
    const timer = window.setTimeout(() => {
      resyncReceipt();
    }, 5000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt, loading, trimmed]);

  return (
    <div style={{ padding: 16 }}>
      <h2>Receipts</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          style={{ width: "100%", maxWidth: 420, padding: 8 }}
          placeholder="Receipt ID / UserOpHash / TxHash"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button onClick={fetchReceipt} disabled={!canFetch || loading}>
          {loading ? "Fetching..." : "Fetch"}
        </button>
      </div>
      {error ? <div style={{ color: "#ff7a7a", marginTop: 8 }}>{error}</div> : null}
      {receipt ? <ReceiptCard receipt={receipt} /> : null}
    </div>
  );
}
