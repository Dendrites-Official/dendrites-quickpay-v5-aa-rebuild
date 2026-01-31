import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatUnits } from "ethers";
import { supabase } from "../lib/supabaseClient";

const USDC_ADDRESS = String(import.meta.env.VITE_USDC_ADDRESS ?? import.meta.env.VITE_USDC ?? "")
  .trim()
  .toLowerCase();
const MDNDX_ADDRESS = String(import.meta.env.VITE_MDNDX_ADDRESS ?? import.meta.env.VITE_MDNDX ?? "")
  .trim()
  .toLowerCase();
const WETH_ADDRESS = String(import.meta.env.VITE_WETH_ADDRESS ?? "0x4200000000000000000000000000000000000006")
  .trim()
  .toLowerCase();
const ENTRYPOINT_ADDRESS = String(import.meta.env.VITE_ENTRYPOINT ?? import.meta.env.VITE_ENTRYPOINT_ADDRESS ?? "").trim();
const PAYMASTER_ADDRESS = String(import.meta.env.VITE_PAYMASTER ?? import.meta.env.VITE_PAYMASTER_ADDRESS ?? "").trim();
const PAYMASTER_BULK_ADDRESS = String(
  import.meta.env.VITE_PAYMASTER_BULK ?? import.meta.env.VITE_PAYMASTER_BULK_ADDRESS ?? ""
).trim();
const ROUTER_ADDRESS = String(import.meta.env.VITE_ROUTER ?? "").trim();
const ROUTER_BULK_ADDRESS = String(
  import.meta.env.VITE_ROUTER_BULK ?? import.meta.env.VITE_ROUTER_BULK_ADDRESS ?? ""
).trim();
const ACKLINK_VAULT_ADDRESS = String(import.meta.env.VITE_ACKLINK_VAULT ?? "").trim();
const ACKLINK_PAYMASTER_ADDRESS = String(import.meta.env.VITE_ACKLINK_PAYMASTER ?? "").trim();
const FACTORY_ADDRESS = String(import.meta.env.VITE_FACTORY ?? "").trim();
const FEEVAULT_ADDRESS = String(import.meta.env.VITE_FEEVAULT ?? "").trim();
const PERMIT2_ADDRESS = String(import.meta.env.VITE_PERMIT2 ?? "").trim();
const ADMIN_LOGIN_URL = String(import.meta.env.VITE_RAILWAY_ADMIN_URL ?? "https://dendrites-quickpay-v5-aa-rebuild-production.up.railway.app/admin").trim();
const MAX_SAMPLE = 10000;
const ADMIN_UI_KEY = String(import.meta.env.VITE_ADMIN_UI_KEY ?? "").trim();

type Metrics = {
  total: number;
  successRate: number;
  daw: number;
  p95: number | null;
  topErrors: Array<{ code: string; count: number }>;
  sampled: boolean;
  txTotal: number;
  txConfirmed: number;
  txPending: number;
  txFailed: number;
  txTotalAll: number;
  txConfirmedAll: number;
  txPendingAll: number;
  txFailedAll: number;
};

type Snapshot = {
  ts: string;
  chain_id: number;
  paymaster_deposit_wei: string | null;
  fee_vault_balances: Record<string, string | null>;
  meta?: Record<string, any> | null;
};

type AcklinkMetrics = {
  total: number;
  created: number;
  claimed: number;
  refunded: number;
  expired: number;
};

type BulkMetrics = {
  total: number;
  confirmed: number;
  pending: number;
  failed: number;
};

type ErrorRow = {
  ts: string;
  route: string;
  error_code: string;
  message_redacted: string | null;
  req_id: string;
};

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function formatBalance(value: string | null, decimals?: number) {
  if (value == null) return "n/a";
  if (!decimals) return value;
  try {
    return formatUnits(BigInt(value), decimals);
  } catch {
    return value;
  }
}

function formatTokenBalance(value: string | null, token: string, decimalsMap: Map<string, number>) {
  const lower = token.toLowerCase();
  const decimals = decimalsMap.get(lower);
  const raw = formatBalance(value, decimals);
  if (raw === "n/a") return raw;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return raw;

  if (lower === USDC_ADDRESS) {
    return `$${numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function formatTokenLabel(token: string) {
  const lower = token.toLowerCase();
  if (lower === USDC_ADDRESS) return "USDC";
  if (lower === MDNDX_ADDRESS) return "mDNDX";
  if (lower === WETH_ADDRESS) return "WETH";
  return token;
}

export default function AdminDashboard() {
  const [loading, setLoading] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [error, setError] = useState("");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [acklinkMetrics, setAcklinkMetrics] = useState<AcklinkMetrics | null>(null);
  const [bulkMetrics, setBulkMetrics] = useState<BulkMetrics | null>(null);
  const [recentErrors, setRecentErrors] = useState<ErrorRow[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const resolvedPaymasterBulk = useMemo(
    () => PAYMASTER_BULK_ADDRESS || String(snapshot?.meta?.paymaster_bulk ?? "").trim(),
    [snapshot]
  );
  const resolvedRouterBulk = useMemo(
    () => ROUTER_BULK_ADDRESS || String(snapshot?.meta?.router_bulk ?? "").trim(),
    [snapshot]
  );

  const tokenDecimals = useMemo(() => {
    const map = new Map<string, number>();
    if (USDC_ADDRESS) map.set(USDC_ADDRESS, 6);
    if (MDNDX_ADDRESS) map.set(MDNDX_ADDRESS, 18);
    if (WETH_ADDRESS) map.set(WETH_ADDRESS, 18);
    return map;
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const totalRes = await supabase
        .from("qp_requests")
        .select("id", { count: "exact", head: true })
        .gte("ts", since);
      if (totalRes.error) throw totalRes.error;

      const successRes = await supabase
        .from("qp_requests")
        .select("id", { count: "exact", head: true })
        .gte("ts", since)
        .eq("ok", true);
      if (successRes.error) throw successRes.error;

      const { data: rows, error: rowsError } = await supabase
        .from("qp_requests")
        .select("wallet,ok,latency_ms,error_code,ts")
        .gte("ts", since)
        .order("ts", { ascending: false })
        .limit(MAX_SAMPLE);
      if (rowsError) throw rowsError;

      const total = totalRes.count ?? rows?.length ?? 0;
      const success = successRes.count ?? rows?.filter((row) => row.ok).length ?? 0;
      const wallets = new Set(
        (rows ?? [])
          .map((row) => String(row.wallet ?? "").trim().toLowerCase())
          .filter(Boolean)
      );
      const latencies = (rows ?? [])
        .map((row) => Number(row.latency_ms))
        .filter((value) => Number.isFinite(value));
      const p95 = percentile(latencies, 0.95);
      const errors = new Map<string, number>();
      for (const row of rows ?? []) {
        const code = String(row.error_code ?? "").trim();
        if (!code) continue;
        errors.set(code, (errors.get(code) ?? 0) + 1);
      }
      const topErrors = [...errors.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([code, count]) => ({ code, count }));

      const { data: snap, error: snapError } = await supabase
        .from("qp_chain_snapshots")
        .select("ts,chain_id,paymaster_deposit_wei,fee_vault_balances,meta")
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (snapError) throw snapError;

      const txTotalRes = await supabase
        .from("quickpay_receipts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since);
      if (txTotalRes.error) throw txTotalRes.error;

      const txConfirmedRes = await supabase
        .from("quickpay_receipts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since)
        .in("status", ["CONFIRMED", "confirmed"]);
      if (txConfirmedRes.error) throw txConfirmedRes.error;

      const txPendingRes = await supabase
        .from("quickpay_receipts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since)
        .in("status", ["created", "sending", "pending", "PENDING"]);
      if (txPendingRes.error) throw txPendingRes.error;

      const txFailedRes = await supabase
        .from("quickpay_receipts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since)
        .in("status", ["FAILED", "failed"]);
      if (txFailedRes.error) throw txFailedRes.error;

      const txTotalAllRes = await supabase
        .from("quickpay_receipts")
        .select("id", { count: "exact", head: true });
      if (txTotalAllRes.error) throw txTotalAllRes.error;

      const txConfirmedAllRes = await supabase
        .from("quickpay_receipts")
        .select("id", { count: "exact", head: true })
        .in("status", ["CONFIRMED", "confirmed"]);
      if (txConfirmedAllRes.error) throw txConfirmedAllRes.error;

      const txPendingAllRes = await supabase
        .from("quickpay_receipts")
        .select("id", { count: "exact", head: true })
        .in("status", ["created", "sending", "pending", "PENDING"]);
      if (txPendingAllRes.error) throw txPendingAllRes.error;

      const txFailedAllRes = await supabase
        .from("quickpay_receipts")
        .select("id", { count: "exact", head: true })
        .in("status", ["FAILED", "failed"]);
      if (txFailedAllRes.error) throw txFailedAllRes.error;

      const ackTotalRes = await supabase
        .from("ack_links")
        .select("id", { count: "exact", head: true });
      if (ackTotalRes.error) throw ackTotalRes.error;

      const ackCreatedRes = await supabase
        .from("ack_links")
        .select("id", { count: "exact", head: true })
        .eq("status", "CREATED");
      if (ackCreatedRes.error) throw ackCreatedRes.error;

      const ackClaimedRes = await supabase
        .from("ack_links")
        .select("id", { count: "exact", head: true })
        .eq("status", "CLAIMED");
      if (ackClaimedRes.error) throw ackClaimedRes.error;

      const ackRefundedRes = await supabase
        .from("ack_links")
        .select("id", { count: "exact", head: true })
        .eq("status", "REFUNDED");
      if (ackRefundedRes.error) throw ackRefundedRes.error;

      const ackExpiredRes = await supabase
        .from("ack_links")
        .select("id", { count: "exact", head: true })
        .eq("status", "CREATED")
        .lt("expires_at", new Date().toISOString());
      if (ackExpiredRes.error) throw ackExpiredRes.error;

      const bulkTotalRes = await supabase
        .from("quickpay_receipts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since)
        .eq("meta->>route", "sendBulk");
      if (bulkTotalRes.error) throw bulkTotalRes.error;

      const bulkConfirmedRes = await supabase
        .from("quickpay_receipts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since)
        .eq("meta->>route", "sendBulk")
        .in("status", ["CONFIRMED", "confirmed"]);
      if (bulkConfirmedRes.error) throw bulkConfirmedRes.error;

      const bulkPendingRes = await supabase
        .from("quickpay_receipts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since)
        .eq("meta->>route", "sendBulk")
        .in("status", ["created", "sending", "pending", "PENDING"]);
      if (bulkPendingRes.error) throw bulkPendingRes.error;

      const bulkFailedRes = await supabase
        .from("quickpay_receipts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since)
        .eq("meta->>route", "sendBulk")
        .in("status", ["FAILED", "failed"]);
      if (bulkFailedRes.error) throw bulkFailedRes.error;

      const { data: errorRows, error: errorsError } = await supabase
        .from("qp_errors")
        .select("ts,route,error_code,message_redacted,req_id")
        .order("ts", { ascending: false })
        .limit(20);
      if (errorsError) throw errorsError;

      setMetrics({
        total,
        successRate: total ? success / total : 0,
        daw: wallets.size,
        p95: p95 ?? null,
        topErrors,
        sampled: total > MAX_SAMPLE,
        txTotal: txTotalRes.count ?? 0,
        txConfirmed: txConfirmedRes.count ?? 0,
        txPending: txPendingRes.count ?? 0,
        txFailed: txFailedRes.count ?? 0,
        txTotalAll: txTotalAllRes.count ?? 0,
        txConfirmedAll: txConfirmedAllRes.count ?? 0,
        txPendingAll: txPendingAllRes.count ?? 0,
        txFailedAll: txFailedAllRes.count ?? 0,
      });
      setAcklinkMetrics({
        total: ackTotalRes.count ?? 0,
        created: ackCreatedRes.count ?? 0,
        claimed: ackClaimedRes.count ?? 0,
        refunded: ackRefundedRes.count ?? 0,
        expired: ackExpiredRes.count ?? 0,
      });
      setBulkMetrics({
        total: bulkTotalRes.count ?? 0,
        confirmed: bulkConfirmedRes.count ?? 0,
        pending: bulkPendingRes.count ?? 0,
        failed: bulkFailedRes.count ?? 0,
      });
      setRecentErrors((errorRows as ErrorRow[]) ?? []);
      setSnapshot((snap as Snapshot) ?? null);
      setLastUpdated(new Date().toISOString());
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const runSnapshot = useCallback(async () => {
    setSnapshotLoading(true);
    setError("");
    try {
      if (!ADMIN_UI_KEY) {
        throw new Error("Missing VITE_ADMIN_UI_KEY");
      }
      const { data, error: fnError } = await supabase.functions.invoke("admin_snapshot_proxy", {
        body: {},
        headers: {
          "x-admin-ui-key": ADMIN_UI_KEY,
        },
      });
      if (fnError) throw new Error(fnError.message || "Snapshot failed");
      await loadData();
      void data;
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSnapshotLoading(false);
    }
  }, [loadData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Admin Dashboard</h2>
        <Link to="/quickpay" style={{ marginLeft: "auto" }}>
          Back to QuickPay
        </Link>
        <button
          onClick={runSnapshot}
          disabled={snapshotLoading}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #333", background: "#222" }}
        >
          {snapshotLoading ? "Fetching..." : "Fetch Snapshot"}
        </button>
        <button
          onClick={loadData}
          disabled={loading}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #333", background: "#222" }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div style={{ color: "#f88", marginBottom: 12 }}>Error: {error}</div>}

      <section style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>DAW (24h)</div>
          <div style={{ fontSize: 24 }}>{metrics?.daw ?? "-"}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>Total Requests (24h)</div>
          <div style={{ fontSize: 24 }}>{metrics?.total ?? "-"}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>Success Rate (24h)</div>
          <div style={{ fontSize: 24 }}>{metrics ? `${(metrics.successRate * 100).toFixed(2)}%` : "-"}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>p95 Latency (24h)</div>
          <div style={{ fontSize: 24 }}>{metrics?.p95 != null ? `${metrics.p95} ms` : "-"}</div>
        </div>
      </section>

      <section style={{ marginTop: 12, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>Tx Total (24h)</div>
          <div style={{ fontSize: 24 }}>{metrics?.txTotal ?? "-"}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>Tx Confirmed (24h)</div>
          <div style={{ fontSize: 24 }}>{metrics?.txConfirmed ?? "-"}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>Tx Pending (24h)</div>
          <div style={{ fontSize: 24 }}>{metrics?.txPending ?? "-"}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>Tx Failed (24h)</div>
          <div style={{ fontSize: 24 }}>{metrics?.txFailed ?? "-"}</div>
        </div>
      </section>

      <section style={{ marginTop: 12, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>Tx Total (All)</div>
          <div style={{ fontSize: 24 }}>{metrics?.txTotalAll ?? "-"}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>Tx Confirmed (All)</div>
          <div style={{ fontSize: 24 }}>{metrics?.txConfirmedAll ?? "-"}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>Tx Pending (All)</div>
          <div style={{ fontSize: 24 }}>{metrics?.txPendingAll ?? "-"}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>Tx Failed (All)</div>
          <div style={{ fontSize: 24 }}>{metrics?.txFailedAll ?? "-"}</div>
        </div>
      </section>

      {metrics?.sampled && (
        <div style={{ marginTop: 8, color: "#777" }}>
          Showing metrics from the latest {MAX_SAMPLE.toLocaleString()} rows (sampling in effect).
        </div>
      )}

      <section style={{ marginTop: 24, display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr" }}>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ marginBottom: 8, color: "#888" }}>Top Errors (24h)</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#666" }}>
                <th style={{ paddingBottom: 6 }}>Error Code</th>
                <th style={{ paddingBottom: 6 }}>Count</th>
              </tr>
            </thead>
            <tbody>
              {(metrics?.topErrors.length ? metrics.topErrors : [{ code: "none", count: 0 }]).map((row) => (
                <tr key={row.code}>
                  <td style={{ padding: "6px 0" }}>{row.code}</td>
                  <td style={{ padding: "6px 0" }}>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ marginBottom: 8, color: "#888" }}>Latest Snapshot</div>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>{snapshot?.ts ?? "-"}</div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ color: "#888" }}>Paymaster Deposit</div>
            <div style={{ fontSize: 16 }}>
              {snapshot?.paymaster_deposit_wei != null
                ? `${formatBalance(snapshot.paymaster_deposit_wei, 18)} ETH`
                : "-"}
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ color: "#888" }}>Bulk Paymaster Deposit</div>
            <div style={{ fontSize: 16 }}>
              {snapshot?.meta?.paymaster_bulk_deposit_wei != null
                ? `${formatBalance(snapshot.meta.paymaster_bulk_deposit_wei, 18)} ETH`
                : "-"}
            </div>
          </div>
          <div>
            <div style={{ color: "#888", marginBottom: 6 }}>FeeVault Balances</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {snapshot?.fee_vault_balances && Object.keys(snapshot.fee_vault_balances).length ? (
                  Object.entries(snapshot.fee_vault_balances).map(([token, value]) => (
                    <tr key={token}>
                      <td style={{ padding: "4px 0", fontSize: 12 }}>{formatTokenLabel(token)}</td>
                      <td style={{ padding: "4px 0", textAlign: "right" }}>
                        {formatTokenBalance(value, token, tokenDecimals)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td style={{ padding: "4px 0", color: "#666" }}>No balances</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 24, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>AckLink Total</div>
          <div style={{ fontSize: 22 }}>{acklinkMetrics?.total ?? "-"}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>AckLink Created</div>
          <div style={{ fontSize: 22 }}>{acklinkMetrics?.created ?? "-"}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>AckLink Claimed</div>
          <div style={{ fontSize: 22 }}>{acklinkMetrics?.claimed ?? "-"}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>AckLink Refunded</div>
          <div style={{ fontSize: 22 }}>{acklinkMetrics?.refunded ?? "-"}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>AckLink Expired</div>
          <div style={{ fontSize: 22 }}>{acklinkMetrics?.expired ?? "-"}</div>
        </div>
      </section>

      <section style={{ marginTop: 24, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>Bulk Total (24h)</div>
          <div style={{ fontSize: 22 }}>{bulkMetrics?.total ?? "-"}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>Bulk Confirmed (24h)</div>
          <div style={{ fontSize: 22 }}>{bulkMetrics?.confirmed ?? "-"}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>Bulk Pending (24h)</div>
          <div style={{ fontSize: 22 }}>{bulkMetrics?.pending ?? "-"}</div>
        </div>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ color: "#888" }}>Bulk Failed (24h)</div>
          <div style={{ fontSize: 22 }}>{bulkMetrics?.failed ?? "-"}</div>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ marginBottom: 8, color: "#888" }}>Recent Errors</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#666" }}>
                <th style={{ paddingBottom: 6 }}>Time</th>
                <th style={{ paddingBottom: 6 }}>Route</th>
                <th style={{ paddingBottom: 6 }}>Code</th>
                <th style={{ paddingBottom: 6 }}>Message</th>
              </tr>
            </thead>
            <tbody>
              {(recentErrors?.length ? recentErrors : [{ ts: "-", route: "-", error_code: "-", message_redacted: null, req_id: "-" }]).map((row, idx) => (
                <tr key={`${row.req_id}-${idx}`}>
                  <td style={{ padding: "6px 6px 6px 0" }}>{row.ts ? new Date(row.ts).toLocaleString() : "-"}</td>
                  <td style={{ padding: "6px 6px" }}>{row.route || "-"}</td>
                  <td style={{ padding: "6px 6px" }}>{row.error_code || "-"}</td>
                  <td style={{ padding: "6px 6px", color: "#bbb" }}>{row.message_redacted || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <div style={{ padding: 16, borderRadius: 8, border: "1px solid #333", background: "#121212" }}>
          <div style={{ marginBottom: 8, color: "#888" }}>Contract Addresses</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {[
                ["EntryPoint", ENTRYPOINT_ADDRESS],
                ["Paymaster", PAYMASTER_ADDRESS],
                ["Paymaster (Bulk)", resolvedPaymasterBulk],
                ["AckLink Vault", ACKLINK_VAULT_ADDRESS],
                ["AckLink Paymaster", ACKLINK_PAYMASTER_ADDRESS],
                ["Router", ROUTER_ADDRESS],
                ["Router (Bulk)", resolvedRouterBulk],
                ["Factory", FACTORY_ADDRESS],
                ["FeeVault", FEEVAULT_ADDRESS],
                ["Permit2", PERMIT2_ADDRESS],
                ["USDC", USDC_ADDRESS],
                ["mDNDX", MDNDX_ADDRESS],
                ["WETH", WETH_ADDRESS],
              ]
                .filter(([, value]) => Boolean(value))
                .map(([label, value]) => (
                  <tr key={label}>
                    <td style={{ padding: "6px 0", color: "#888", width: 140 }}>{label}</td>
                    <td style={{ padding: "6px 0", fontSize: 12 }}>{value}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: 12 }}>
        <div style={{ padding: 12, borderRadius: 8, border: "1px solid #333", background: "#121212", fontSize: 12 }}>
          <span style={{ color: "#888" }}>Railway Admin Login:</span>{" "}
          <a href={ADMIN_LOGIN_URL} target="_blank" rel="noreferrer">
            {ADMIN_LOGIN_URL}
          </a>
        </div>
      </section>

      <div style={{ marginTop: 12, color: "#666" }}>
        Last updated: {lastUpdated ?? "-"}
      </div>
    </div>
  );
}
