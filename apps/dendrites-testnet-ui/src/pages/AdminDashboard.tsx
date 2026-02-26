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
  const SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

  type Metrics = {
    total: number;
    successRate: number;
    totalAllRequests: number;
    successRateAll: number;
    daw: number;
    p95: number | null;
    topErrors: Array<{ code: string; count: number }>;
    sampled: boolean;
    connections24: number;
    connections24Unique: number;
    connectionsAll: number;
    connectionsAllUnique: number;
    connectionsSampled24: boolean;
    connectionsSampledAll: boolean;
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

  type ConnectionRow = {
    connected_at: string;
    wallet: string | null;
    geo_country: string | null;
    geo_region: string | null;
    geo_city: string | null;
  };

  type FunnelMetrics = {
    visits: number;
    connects: number;
    quickpayQuotes: number;
    quickpaySends: number;
    acklinkCreates: number;
    acklinkClaims: number;
    bulkQuotes: number;
    bulkSends: number;
  };

  type RequestRow = {
    ts: string;
    ok: boolean;
    latency_ms: number | null;
  };

  type TrendSeries = {
    requests: number[];
    successRate: number[];
    latencyAvg: number[];
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

  function buildHourlySeries(rows: RequestRow[], now: number): TrendSeries {
    const buckets = 24 * 7;
    const req = Array.from({ length: buckets }, () => 0);
    const ok = Array.from({ length: buckets }, () => 0);
    const latencySum = Array.from({ length: buckets }, () => 0);
    const latencyCount = Array.from({ length: buckets }, () => 0);

    for (const row of rows) {
      const ts = Date.parse(row.ts);
      if (!Number.isFinite(ts)) continue;
      const diffHours = Math.floor((now - ts) / (60 * 60 * 1000));
      if (diffHours < 0 || diffHours >= buckets) continue;
      const idx = buckets - 1 - diffHours;
      req[idx] += 1;
      if (row.ok) ok[idx] += 1;
      if (Number.isFinite(row.latency_ms as number)) {
        latencySum[idx] += Number(row.latency_ms ?? 0);
        latencyCount[idx] += 1;
      }
    }

    const successRate = req.map((count, i) => (count ? ok[i] / count : 0));
    const latencyAvg = latencySum.map((sum, i) => (latencyCount[i] ? sum / latencyCount[i] : 0));

    return { requests: req, successRate, latencyAvg };
  }

  function Sparkline({ values, stroke }: { values: number[]; stroke?: string }) {
    const width = 120;
    const height = 32;
    const safe = values.length ? values : [0];
    const min = Math.min(...safe);
    const max = Math.max(...safe);
    const range = max - min || 1;

    const points = safe
      .map((v, i) => {
        const x = (i / (safe.length - 1 || 1)) * (width - 2) + 1;
        const y = height - 1 - ((v - min) / range) * (height - 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

    return (
      <svg className="dx-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <polyline
          fill="none"
          stroke={stroke ?? "rgba(0,112,243,0.9)"}
          strokeWidth={1.6}
          points={points}
        />
      </svg>
    );
  }

  export default function AdminDashboard() {
    const [loading, setLoading] = useState(false);
    const [snapshotLoading, setSnapshotLoading] = useState(false);
    const [error, setError] = useState("");
    const [connectionError, setConnectionError] = useState("");
    const [metrics, setMetrics] = useState<Metrics | null>(null);
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [acklinkMetrics, setAcklinkMetrics] = useState<AcklinkMetrics | null>(null);
    const [bulkMetrics, setBulkMetrics] = useState<BulkMetrics | null>(null);
    const [recentErrors, setRecentErrors] = useState<ErrorRow[]>([]);
    const [recentConnections, setRecentConnections] = useState<ConnectionRow[]>([]);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [trend, setTrend] = useState<TrendSeries | null>(null);
    const [funnel, setFunnel] = useState<FunnelMetrics | null>(null);
    const [funnelError, setFunnelError] = useState("");

    const hasRequests = (metrics?.total ?? 0) > 0;
    const hasRequestsAll = (metrics?.totalAllRequests ?? 0) > 0;
    const successRateLabel = metrics
      ? hasRequests
        ? `${(metrics.successRate * 100).toFixed(2)}%`
        : "—"
      : "-";
    const successRateAllLabel = metrics
      ? hasRequestsAll
        ? `${(metrics.successRateAll * 100).toFixed(2)}%`
        : "—"
      : "-";

    const resolvedPaymasterBulk = useMemo(
      () => PAYMASTER_BULK_ADDRESS || String(snapshot?.meta?.paymaster_bulk ?? "").trim(),
      [snapshot]
    );
    const resolvedAcklinkPaymaster = useMemo(
      () => ACKLINK_PAYMASTER_ADDRESS || String(snapshot?.meta?.paymaster_acklink ?? "").trim(),
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


    // UI-only: Recent Errors search + quick filters
const [errorSearch, setErrorSearch] = useState("");

const quickErrorCodes = useMemo(() => {
  const codes = (metrics?.topErrors ?? []).map((x) => x.code).filter(Boolean);
  return Array.from(new Set(codes)).slice(0, 5);
}, [metrics]);

const quickErrorRoutes = useMemo(() => {
  const counts = new Map<string, number>();
  for (const r of recentErrors ?? []) {
    const route = String(r.route ?? "").trim();
    if (!route) continue;
    counts.set(route, (counts.get(route) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([route]) => route);
}, [recentErrors]);

const filteredRecentErrors = useMemo(() => {
  const q = errorSearch.trim().toLowerCase();
  if (!q) return recentErrors;

  const tokens = q.split(/\s+/).filter(Boolean);

  const pick = (row: ErrorRow) => {
    const ts = String(row.ts ?? "").toLowerCase();
    const route = String(row.route ?? "").toLowerCase();
    const code = String(row.error_code ?? "").toLowerCase();
    const msg = String(row.message_redacted ?? "").toLowerCase();
    const req = String(row.req_id ?? "").toLowerCase();

    const anyField = `${ts} ${route} ${code} ${msg} ${req}`;

    return tokens.every((t) => {
      const idx = t.indexOf(":");
      if (idx > 0) {
        const key = t.slice(0, idx);
        const val = t.slice(idx + 1);
        if (!val) return true;

        if (key === "route") return route.includes(val);
        if (key === "code") return code.includes(val);
        if (key === "req") return req.includes(val);
        if (key === "msg") return msg.includes(val);
        if (key === "time" || key === "ts") return ts.includes(val);
        return anyField.includes(t);
      }
      return anyField.includes(t);
    });
  };

  return (recentErrors ?? []).filter(pick);
}, [recentErrors, errorSearch]);


    const loadData = useCallback(async () => {
      setLoading(true);
      setError("");
      setConnectionError("");
      setFunnelError("");
      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const totalRes = await supabase
          .from("qp_requests")
          .select("id", { count: "exact" })
          .gte("ts", since)
          .limit(1);
        if (totalRes.error) throw totalRes.error;

        const successRes = await supabase
          .from("qp_requests")
          .select("id", { count: "exact" })
          .gte("ts", since)
          .eq("ok", true)
          .limit(1);
        if (successRes.error) throw successRes.error;

        const totalAllReqRes = await supabase
          .from("qp_requests")
          .select("id", { count: "exact" })
          .limit(1);
        if (totalAllReqRes.error) throw totalAllReqRes.error;

        const successAllReqRes = await supabase
          .from("qp_requests")
          .select("id", { count: "exact" })
          .eq("ok", true)
          .limit(1);
        if (successAllReqRes.error) throw successAllReqRes.error;

        const { data: rows, error: rowsError } = await supabase
          .from("qp_requests")
          .select("wallet,ok,latency_ms,error_code,ts")
          .gte("ts", since)
          .order("ts", { ascending: false })
          .limit(MAX_SAMPLE);
        if (rowsError) throw rowsError;

        const nowMs = Date.now();
        const requestRows = (rows as RequestRow[]) ?? [];
        setTrend(buildHourlySeries(requestRows, nowMs));

        const total = totalRes.count ?? rows?.length ?? 0;
        const success = successRes.count ?? rows?.filter((row) => row.ok).length ?? 0;
        const totalAll = totalAllReqRes.count ?? 0;
        const successAll = successAllReqRes.count ?? 0;
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
          .select("id", { count: "exact" })
          .gte("created_at", since)
          .limit(1);
        if (txTotalRes.error) throw txTotalRes.error;

        const txConfirmedRes = await supabase
          .from("quickpay_receipts")
          .select("id", { count: "exact" })
          .gte("created_at", since)
          .in("status", ["CONFIRMED", "confirmed"])
          .limit(1);
        if (txConfirmedRes.error) throw txConfirmedRes.error;

        const txPendingRes = await supabase
          .from("quickpay_receipts")
          .select("id", { count: "exact" })
          .gte("created_at", since)
          .in("status", ["created", "sending", "pending", "PENDING"])
          .limit(1);
        if (txPendingRes.error) throw txPendingRes.error;

        const txFailedRes = await supabase
          .from("quickpay_receipts")
          .select("id", { count: "exact" })
          .gte("created_at", since)
          .in("status", ["FAILED", "failed"])
          .limit(1);
        if (txFailedRes.error) throw txFailedRes.error;

        const txTotalAllRes = await supabase
          .from("quickpay_receipts")
          .select("id", { count: "exact" })
          .limit(1);
        if (txTotalAllRes.error) throw txTotalAllRes.error;

        const txConfirmedAllRes = await supabase
          .from("quickpay_receipts")
          .select("id", { count: "exact" })
          .in("status", ["CONFIRMED", "confirmed"])
          .limit(1);
        if (txConfirmedAllRes.error) throw txConfirmedAllRes.error;

        const txPendingAllRes = await supabase
          .from("quickpay_receipts")
          .select("id", { count: "exact" })
          .in("status", ["created", "sending", "pending", "PENDING"])
          .limit(1);
        if (txPendingAllRes.error) throw txPendingAllRes.error;

        const txFailedAllRes = await supabase
          .from("quickpay_receipts")
          .select("id", { count: "exact" })
          .in("status", ["FAILED", "failed"])
          .limit(1);
        if (txFailedAllRes.error) throw txFailedAllRes.error;

        const ackTotalRes = await supabase
          .from("ack_links")
          .select("id", { count: "exact" })
          .gte("created_at", since)
          .limit(1);
        if (ackTotalRes.error) throw ackTotalRes.error;

        const ackCreatedRes = await supabase
          .from("ack_links")
          .select("id", { count: "exact" })
          .gte("created_at", since)
          .eq("status", "CREATED")
          .limit(1);
        if (ackCreatedRes.error) throw ackCreatedRes.error;

        const ackClaimedRes = await supabase
          .from("ack_links")
          .select("id", { count: "exact" })
          .gte("created_at", since)
          .eq("status", "CLAIMED")
          .limit(1);
        if (ackClaimedRes.error) throw ackClaimedRes.error;

        const ackRefundedRes = await supabase
          .from("ack_links")
          .select("id", { count: "exact" })
          .gte("created_at", since)
          .eq("status", "REFUNDED")
          .limit(1);
        if (ackRefundedRes.error) throw ackRefundedRes.error;

        const ackExpiredRes = await supabase
          .from("ack_links")
          .select("id", { count: "exact" })
          .gte("created_at", since)
          .eq("status", "CREATED")
          .lt("expires_at", new Date().toISOString())
          .limit(1);
        if (ackExpiredRes.error) throw ackExpiredRes.error;

        const bulkTotalRes = await supabase
          .from("quickpay_receipts")
          .select("id", { count: "exact" })
          .gte("created_at", since)
          .eq("meta->>route", "sendBulk")
          .limit(1);
        if (bulkTotalRes.error) throw bulkTotalRes.error;

        const bulkConfirmedRes = await supabase
          .from("quickpay_receipts")
          .select("id", { count: "exact" })
          .gte("created_at", since)
          .eq("meta->>route", "sendBulk")
          .in("status", ["CONFIRMED", "confirmed"])
          .limit(1);
        if (bulkConfirmedRes.error) throw bulkConfirmedRes.error;

        const bulkPendingRes = await supabase
          .from("quickpay_receipts")
          .select("id", { count: "exact" })
          .gte("created_at", since)
          .eq("meta->>route", "sendBulk")
          .in("status", ["created", "sending", "pending", "PENDING"])
          .limit(1);
        if (bulkPendingRes.error) throw bulkPendingRes.error;

        const bulkFailedRes = await supabase
          .from("quickpay_receipts")
          .select("id", { count: "exact" })
          .gte("created_at", since)
          .eq("meta->>route", "sendBulk")
          .in("status", ["FAILED", "failed"])
          .limit(1);
        if (bulkFailedRes.error) throw bulkFailedRes.error;

        const { data: errorRows, error: errorsError } = await supabase
          .from("qp_errors")
          .select("ts,route,error_code,message_redacted,req_id")
          .order("ts", { ascending: false })
          .limit(20);
        if (errorsError) throw errorsError;

        try {
          const countEvent = async (kind: string) => {
            const { count, error: countError } = await supabase
              .from("app_events")
              .select("id", { count: "exact" })
              .gte("created_at", since)
              .eq("kind", kind)
              .limit(1);
            if (countError) throw countError;
            return count ?? 0;
          };

          const [
            visits,
            connects,
            quickpayQuotes,
            quickpaySends,
            acklinkCreates,
            acklinkClaims,
            bulkQuotes,
            bulkSends,
          ] = await Promise.all([
            countEvent("page_view"),
            countEvent("wallet_connect"),
            countEvent("quickpay_quote_success"),
            countEvent("quickpay_send_success"),
            countEvent("acklink_create_success"),
            countEvent("acklink_claim_success"),
            countEvent("bulk_quote_success"),
            countEvent("bulk_send_success"),
          ]);

          setFunnel({
            visits,
            connects,
            quickpayQuotes,
            quickpaySends,
            acklinkCreates,
            acklinkClaims,
            bulkQuotes,
            bulkSends,
          });
        } catch (fErr: any) {
          setFunnelError(fErr?.message || String(fErr));
        }

        const baseMetrics: Metrics = {
          total,
          successRate: total ? success / total : 0,
          totalAllRequests: totalAll,
          successRateAll: totalAll ? successAll / totalAll : 0,
          daw: wallets.size,
          p95: p95 ?? null,
          topErrors,
          sampled: total > MAX_SAMPLE,
          connections24: 0,
          connections24Unique: 0,
          connectionsAll: 0,
          connectionsAllUnique: 0,
          connectionsSampled24: false,
          connectionsSampledAll: false,
          txTotal: txTotalRes.count ?? 0,
          txConfirmed: txConfirmedRes.count ?? 0,
          txPending: txPendingRes.count ?? 0,
          txFailed: txFailedRes.count ?? 0,
          txTotalAll: txTotalAllRes.count ?? 0,
          txConfirmedAll: txConfirmedAllRes.count ?? 0,
          txPendingAll: txPendingAllRes.count ?? 0,
          txFailedAll: txFailedAllRes.count ?? 0,
        };

        setMetrics(baseMetrics);
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
        setRecentConnections([]);

        try {
          if (!ADMIN_UI_KEY) {
            throw new Error("Missing VITE_ADMIN_UI_KEY");
          }
          const { data: connectionPayload, error: connectionFnError } = await supabase.functions.invoke(
            "admin_connections_metrics",
            {
              body: {},
              headers: {
                "x-admin-ui-key": ADMIN_UI_KEY,
                ...(SUPABASE_ANON_KEY ? { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {}),
              },
            }
          );
          if (connectionFnError) throw new Error(connectionFnError.message || "Connection metrics failed");

          const connectionMetrics = (connectionPayload as any)?.metrics ?? {};
          const connectionRows = (connectionPayload as any)?.recentConnections ?? [];
          const connections24 = Number(connectionMetrics.connections24 ?? 0);
          const connectionsAll = Number(connectionMetrics.connectionsAll ?? 0);
          const connections24Unique = Number(connectionMetrics.connections24Unique ?? 0);
          const connectionsAllUnique = Number(connectionMetrics.connectionsAllUnique ?? 0);

          setMetrics((prev) =>
            prev
              ? {
                  ...prev,
                  connections24,
                  connections24Unique,
                  connectionsAll,
                  connectionsAllUnique,
                }
              : prev
          );
          setRecentConnections((connectionRows as ConnectionRow[]) ?? []);
        } catch (connErr: any) {
          setConnectionError(connErr?.message || String(connErr));
        }
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
            ...(SUPABASE_ANON_KEY ? { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {}),
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
    <div className="dx-container" style={{ maxWidth: "none" }}>

      <div className="dx-kicker">Admin</div>

      <div className="dx-card-head" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="dx-h1">Admin Dashboard</h1>
          <div className="dx-sub">Operations snapshot + health metrics (24h + all-time).</div>
        </div>

        <div className="dx-actions" style={{ marginTop: 0 }}>
          <Link className="dx-linkBtn" to="/quickpay">
            ← Back to QuickPay
          </Link>
          <button className="dx-miniBtn" onClick={runSnapshot} disabled={snapshotLoading}>
            {snapshotLoading ? "Fetching..." : "Fetch Snapshot"}
          </button>
          <button className="dx-miniBtn" onClick={loadData} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="dx-alert dx-alert-danger" style={{ marginTop: 14 }}>
          Error: {error}
        </div>
      ) : null}
      {connectionError ? (
        <div className="dx-alert dx-alert-warn" style={{ marginTop: 10 }}>
          Connection metrics unavailable: {connectionError}
        </div>
      ) : null}

      {metrics && metrics.total === 0 ? (
        <div className="dx-alert dx-alert-warn" style={{ marginTop: 10 }}>
          No request data in the last 24h yet. Metrics will populate as traffic arrives.
        </div>
      ) : null}

      {funnelError ? (
        <div className="dx-alert dx-alert-warn" style={{ marginTop: 10 }}>
          Funnel metrics unavailable: {funnelError}
        </div>
      ) : null}

      <div className="dx-section" style={{ marginTop: 14 }}>
        <div className="dx-section-head">
          <div>
            <div className="dx-card-title">Investor Overview (7d)</div>
            <div className="dx-card-hint">High-level signals for growth and reliability.</div>
          </div>
        </div>
        <div className="dx-metricsGrid dx-metricsGrid--tight">
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">Success Rate</div>
              <div className="dx-card-value dx-card-value--sm">{successRateLabel}</div>
              {trend ? <Sparkline values={trend.successRate} stroke="rgba(46,229,157,0.95)" /> : null}
            </div>
          </div>
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">Requests (24h)</div>
              <div className="dx-card-value dx-card-value--sm">{metrics?.total ?? "-"}</div>
              {trend ? <Sparkline values={trend.requests} /> : null}
            </div>
          </div>
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">Connections (24h)</div>
              <div className="dx-card-value dx-card-value--sm">{metrics?.connections24 ?? "-"}</div>
            </div>
          </div>
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">Tx Confirmed (24h)</div>
              <div className="dx-card-value dx-card-value--sm">{metrics?.txConfirmed ?? "-"}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="dx-section">
        <div className="dx-section-head">
          <div>
            <div className="dx-card-title">Overview (24h)</div>
            <div className="dx-card-hint">Traffic + latency health.</div>
          </div>
        </div>
        <div className="dx-metricsGrid">
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">DAW</div>
              <div className="dx-card-value">{metrics?.daw ?? "-"}</div>
              <div className="dx-card-hint">Daily active wallets</div>
            </div>
          </div>

          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">Requests</div>
              <div className="dx-card-value">{metrics?.total ?? "-"}</div>
              <div className="dx-card-hint">API requests in last 24h</div>
            </div>
          </div>

          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">Success Rate</div>
              <div className="dx-card-value">{successRateLabel}</div>
              <div className="dx-card-hint">ok=true / total</div>
            </div>
          </div>

          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">p95 Latency</div>
              <div className="dx-card-value">
                {metrics?.p95 != null ? `${metrics.p95} ms` : "-"}
              </div>
              <div className="dx-card-hint">95th percentile</div>
            </div>
          </div>
        </div>
      </div>

      <div className="dx-section">
        <div className="dx-section-head">
          <div>
            <div className="dx-card-title">Funnel (24h)</div>
            <div className="dx-card-hint">Investor-grade adoption flow.</div>
          </div>
        </div>
        <div className="dx-metricsGrid dx-metricsGrid--tight">
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">Visits</div>
              <div className="dx-card-value dx-card-value--sm">{funnel?.visits ?? "-"}</div>
            </div>
          </div>
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">Wallet Connects</div>
              <div className="dx-card-value dx-card-value--sm">{funnel?.connects ?? "-"}</div>
            </div>
          </div>
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">QuickPay Quotes</div>
              <div className="dx-card-value dx-card-value--sm">{funnel?.quickpayQuotes ?? "-"}</div>
            </div>
          </div>
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">QuickPay Sends</div>
              <div className="dx-card-value dx-card-value--sm">{funnel?.quickpaySends ?? "-"}</div>
            </div>
          </div>
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">AckLink Creates</div>
              <div className="dx-card-value dx-card-value--sm">{funnel?.acklinkCreates ?? "-"}</div>
            </div>
          </div>
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">Bulk Sends</div>
              <div className="dx-card-value dx-card-value--sm">{funnel?.bulkSends ?? "-"}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="dx-section">
        <div className="dx-section-head">
          <div>
            <div className="dx-card-title">Payments (24h)</div>
            <div className="dx-card-hint">QuickPay + AckLink + Bulk in one view.</div>
          </div>
        </div>
        <div className="dx-metricsGrid dx-metricsGrid--tight">
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">QuickPay</div>
              <div className="dx-statList">
                <div className="dx-statItem">
                  <span>Total</span>
                  <strong>{metrics?.txTotal ?? "-"}</strong>
                </div>
                <div className="dx-statItem">
                  <span>Confirmed</span>
                  <strong>{metrics?.txConfirmed ?? "-"}</strong>
                </div>
                <div className="dx-statItem">
                  <span>Pending</span>
                  <strong>{metrics?.txPending ?? "-"}</strong>
                </div>
                <div className="dx-statItem">
                  <span>Failed</span>
                  <strong>{metrics?.txFailed ?? "-"}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">AckLink</div>
              <div className="dx-statList">
                <div className="dx-statItem">
                  <span>Total</span>
                  <strong>{acklinkMetrics?.total ?? "-"}</strong>
                </div>
                <div className="dx-statItem">
                  <span>Created</span>
                  <strong>{acklinkMetrics?.created ?? "-"}</strong>
                </div>
                <div className="dx-statItem">
                  <span>Claimed</span>
                  <strong>{acklinkMetrics?.claimed ?? "-"}</strong>
                </div>
                <div className="dx-statItem">
                  <span>Refunded</span>
                  <strong>{acklinkMetrics?.refunded ?? "-"}</strong>
                </div>
                <div className="dx-statItem">
                  <span>Expired</span>
                  <strong>{acklinkMetrics?.expired ?? "-"}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">Bulk</div>
              <div className="dx-statList">
                <div className="dx-statItem">
                  <span>Total</span>
                  <strong>{bulkMetrics?.total ?? "-"}</strong>
                </div>
                <div className="dx-statItem">
                  <span>Confirmed</span>
                  <strong>{bulkMetrics?.confirmed ?? "-"}</strong>
                </div>
                <div className="dx-statItem">
                  <span>Pending</span>
                  <strong>{bulkMetrics?.pending ?? "-"}</strong>
                </div>
                <div className="dx-statItem">
                  <span>Failed</span>
                  <strong>{bulkMetrics?.failed ?? "-"}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="dx-section">
        <div className="dx-section-head">
          <div>
            <div className="dx-card-title">Connections (24h)</div>
            <div className="dx-card-hint">Wallet connect events</div>
          </div>
        </div>
        <div className="dx-metricsGrid dx-metricsGrid--tight">
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">Connections</div>
              <div className="dx-card-value dx-card-value--sm">{metrics?.connections24 ?? "-"}</div>
            </div>
          </div>
          <div className="dx-card">
            <div className="dx-card-in">
              <div className="dx-card-title">Unique Wallets</div>
              <div className="dx-card-value dx-card-value--sm">{metrics?.connections24Unique ?? "-"}</div>
            </div>
          </div>
        </div>
      </div>

      {metrics?.sampled ? (
        <div className="dx-alert dx-alert-warn">
          Showing metrics from the latest {MAX_SAMPLE.toLocaleString()} rows (sampling in effect).
        </div>
      ) : null}
      {metrics?.connectionsSampled24 || metrics?.connectionsSampledAll ? (
        <div className="dx-alert dx-alert-warn">
          Connection metrics are sampled to the latest {MAX_SAMPLE.toLocaleString()} rows.
        </div>
      ) : null}

      <details className="dx-card dx-detail" style={{ marginTop: 14 }} open>
        <summary className="dx-detail-summary">All-time metrics</summary>
        <div className="dx-card-in">
          <div className="dx-section">
            <div className="dx-section-head">
              <div>
                <div className="dx-card-title">Transactions (All)</div>
              </div>
            </div>
            <div className="dx-metricsGrid dx-metricsGrid--tight">
              <div className="dx-card">
                <div className="dx-card-in">
                  <div className="dx-card-title">Success Rate</div>
                  <div className="dx-card-value dx-card-value--sm">{successRateAllLabel}</div>
                </div>
              </div>
              <div className="dx-card">
                <div className="dx-card-in">
                  <div className="dx-card-title">Total</div>
                  <div className="dx-card-value dx-card-value--sm">{metrics?.txTotalAll ?? "-"}</div>
                </div>
              </div>
              <div className="dx-card">
                <div className="dx-card-in">
                  <div className="dx-card-title">Confirmed</div>
                  <div className="dx-card-value dx-card-value--sm">{metrics?.txConfirmedAll ?? "-"}</div>
                </div>
              </div>
              <div className="dx-card">
                <div className="dx-card-in">
                  <div className="dx-card-title">Pending</div>
                  <div className="dx-card-value dx-card-value--sm">{metrics?.txPendingAll ?? "-"}</div>
                </div>
              </div>
              <div className="dx-card">
                <div className="dx-card-in">
                  <div className="dx-card-title">Failed</div>
                  <div className="dx-card-value dx-card-value--sm">{metrics?.txFailedAll ?? "-"}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="dx-section">
            <div className="dx-section-head">
              <div>
                <div className="dx-card-title">Connections (All)</div>
              </div>
            </div>
            <div className="dx-metricsGrid dx-metricsGrid--tight">
              <div className="dx-card">
                <div className="dx-card-in">
                  <div className="dx-card-title">Connections</div>
                  <div className="dx-card-value dx-card-value--sm">{metrics?.connectionsAll ?? "-"}</div>
                </div>
              </div>
              <div className="dx-card">
                <div className="dx-card-in">
                  <div className="dx-card-title">Unique Wallets</div>
                  <div className="dx-card-value dx-card-value--sm">{metrics?.connectionsAllUnique ?? "-"}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </details>


      <details className="dx-card dx-detail" style={{ marginTop: 14 }}>
        <summary className="dx-detail-summary">Recent Errors</summary>
        <div className="dx-card-in">
          <div className="dx-card-head">
            <div>
              <div className="dx-card-title">Recent Errors</div>
              <div className="dx-card-hint">
                Searchable + scrollable (latest 20). Search supports:{" "}
                <span className="dx-mono">route:</span>, <span className="dx-mono">code:</span>,{" "}
                <span className="dx-mono">req:</span>, <span className="dx-mono">msg:</span>. Multiple terms = AND.
              </div>
            </div>

            <div className="dx-miniRow" style={{ justifyContent: "flex-end" }}>
              <span className="dx-pill dx-pillBlue">
                Showing {filteredRecentErrors.length}/{recentErrors.length}
              </span>
            </div>
          </div>

          {(metrics?.topErrors?.length ?? 0) > 0 ? (
            <div className="dx-miniRow" style={{ marginBottom: 6 }}>
              {metrics?.topErrors.map((row) => (
                <span key={row.code} className="dx-pill">
                  {row.code}: {row.count}
                </span>
              ))}
            </div>
          ) : null}

          <div className="dx-form" style={{ marginTop: 10 }}>
            <div className="dx-row2" style={{ gridTemplateColumns: "1fr 170px" }}>
              <div className="dx-field">
                <div className="dx-label">Search</div>
                <input
                  placeholder="Try: route:sendBulk code:insufficient msg:nonce req:abcd"
                  value={errorSearch}
                  onChange={(e) => setErrorSearch(e.target.value)}
                />
                <div className="dx-help">
                  Examples: <span className="dx-mono">sendBulk</span> ·{" "}
                  <span className="dx-mono">code:FAILED</span> ·{" "}
                  <span className="dx-mono">route:sendBulk</span> ·{" "}
                  <span className="dx-mono">msg:underpriced</span> ·{" "}
                  <span className="dx-mono">req:9c1</span>
                </div>
              </div>

              <div className="dx-field">
                <div className="dx-label">Actions</div>
                <button
                  type="button"
                  className="dx-miniBtn"
                  onClick={() => setErrorSearch("")}
                  disabled={!errorSearch.trim()}
                >
                  Clear
                </button>
                <div className="dx-help">Resets filter.</div>
              </div>
            </div>

            {(quickErrorCodes.length || quickErrorRoutes.length) ? (
              <div className="dx-field">
                <div className="dx-label">Quick filters</div>
                <div className="dx-miniRow">
                  {quickErrorCodes.map((c) => (
                    <button
                      key={`code-${c}`}
                      type="button"
                      className="dx-miniBtn"
                      onClick={() => setErrorSearch(`code:${c}`)}
                      title={`Filter by code:${c}`}
                    >
                      code:{c}
                    </button>
                  ))}
                  {quickErrorRoutes.map((r) => (
                    <button
                      key={`route-${r}`}
                      type="button"
                      className="dx-miniBtn"
                      onClick={() => setErrorSearch(`route:${r}`)}
                      title={`Filter by route:${r}`}
                    >
                      route:{r}
                    </button>
                  ))}
                </div>
                <div className="dx-help">Tap a chip to auto-fill the search box.</div>
              </div>
            ) : null}
          </div>

         <div className="dx-tableWrap dx-recentErrors" style={{ marginTop: 0 }}>
        <div
          className="dx-tableScroll"
          style={{
            overflow: "auto",
            maxHeight: "min(520px, 62vh)", // vertical scroll + responsive
          }}
        >
          <table className="dx-table">
            <colgroup>
              <col style={{ width: 190 }} />
              <col style={{ width: 190 }} />
              <col style={{ width: 140 }} />
              <col />
            </colgroup>

            <thead>
              <tr>
                <th className="dx-th">Time</th>
                <th className="dx-th">Route</th>
                <th className="dx-th">Code</th>
                <th className="dx-th">Message</th>
              </tr>
            </thead>

            <tbody>
              {(filteredRecentErrors?.length
                ? filteredRecentErrors
                : [{ ts: "-", route: "-", error_code: "-", message_redacted: null, req_id: "-" } as any]
              ).map((row: any, idx: number) => (
                <tr key={`${row.req_id}-${idx}`} className="dx-row">
                  <td className="dx-td dx-ellipsis" title={row.ts ? new Date(row.ts).toLocaleString() : "-"}>
                    {row.ts ? new Date(row.ts).toLocaleString() : "-"}
                  </td>

                  <td className="dx-td dx-ellipsis" title={row.route || "-"}>
                    {row.route || "-"}
                  </td>

                  <td className="dx-td dx-ellipsis" title={row.error_code || "-"}>
                    {row.error_code || "-"}
                  </td>

                  <td className="dx-td dx-msgCell" style={{ color: "rgba(255,255,255,0.72)" }}>
                    {row.message_redacted || "-"}
                    {row.req_id ? <div className="dx-subline dx-mono">req: {row.req_id}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
        </div>
      </details>


      <div className="dx-grid" style={{ marginTop: 14 }}>
        <div className="dx-card">
          <div className="dx-card-in">
            <div className="dx-card-head">
              <div>
                <div className="dx-card-title">Latest Snapshot</div>
                <div className="dx-card-hint">{snapshot?.ts ?? "-"}</div>
              </div>
            </div>

            <div className="dx-kv">
              <div className="dx-k">Paymaster Deposit</div>
              <div className="dx-v dx-mono">
                {snapshot?.paymaster_deposit_wei != null
                  ? `${formatBalance(snapshot.paymaster_deposit_wei, 18)} ETH`
                  : "-"}
              </div>

              <div className="dx-k">AckLink Paymaster Deposit</div>
              <div className="dx-v dx-mono">
                {snapshot?.meta?.paymaster_acklink_deposit_wei != null
                  ? `${formatBalance(snapshot.meta.paymaster_acklink_deposit_wei, 18)} ETH`
                  : "-"}
                {resolvedAcklinkPaymaster ? (
                  <div className="dx-subline dx-mono">{resolvedAcklinkPaymaster}</div>
                ) : null}
              </div>

              <div className="dx-k">Bulk Paymaster Deposit</div>
              <div className="dx-v dx-mono">
                {snapshot?.meta?.paymaster_bulk_deposit_wei != null
                  ? `${formatBalance(snapshot.meta.paymaster_bulk_deposit_wei, 18)} ETH`
                  : "-"}
              </div>
            </div>

            <div className="dx-divider" />

            <div className="dx-card-title" style={{ marginBottom: 10 }}>
              FeeVault Balances
            </div>

            <div className="dx-tableWrap" style={{ marginTop: 0 }}>
              <div className="dx-tableScroll">
                <table className="dx-table" style={{ minWidth: 520 }}>
                  <tbody>
                    {snapshot?.fee_vault_balances && Object.keys(snapshot.fee_vault_balances).length ? (
                      Object.entries(snapshot.fee_vault_balances).map(([token, value]) => (
                        <tr key={token} className="dx-row">
                          <td className="dx-td">{formatTokenLabel(token)}</td>
                          <td className="dx-td" style={{ textAlign: "right" }}>
                            {formatTokenBalance(value, token, tokenDecimals)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="dx-td dx-muted">No balances</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div className="dx-card">
          <div className="dx-card-in">
            <div className="dx-card-head">
              <div>
                <div className="dx-card-title">Recent Connections</div>
                <div className="dx-card-hint">Most recent wallet connect events.</div>
              </div>
            </div>

            <div className="dx-tableWrap" style={{ marginTop: 0 }}>
              <div className="dx-tableScroll">
                <table className="dx-table" style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th className="dx-th">Time</th>
                      <th className="dx-th">Wallet</th>
                      <th className="dx-th">Geo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recentConnections ?? []).map((row) => {
                      const geoParts = [row.geo_city, row.geo_region, row.geo_country]
                        .map((part) => String(part ?? "").trim())
                        .filter(Boolean);
                      return (
                        <tr key={`${row.connected_at}-${row.wallet ?? ""}`}>
                          <td className="dx-td">{row.connected_at ? new Date(row.connected_at).toLocaleString() : "-"}</td>
                          <td className="dx-td">{row.wallet ?? "-"}</td>
                          <td className="dx-td">{geoParts.length ? geoParts.join(", ") : "-"}</td>
                        </tr>
                      );
                    })}
                    {!recentConnections?.length ? (
                      <tr>
                        <td className="dx-td" colSpan={3}>
                          No connection events yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Contract addresses */}
      <div className="dx-card" style={{ marginTop: 14 }}>
        <div className="dx-card-in">
          <div className="dx-card-head">
            <div>
              <div className="dx-card-title">Contract Addresses</div>
              <div className="dx-card-hint">Resolved env + snapshot meta.</div>
            </div>
          </div>

          <div className="dx-kv">
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
                <div key={label} style={{ display: "contents" }}>
                  <div className="dx-k">{label}</div>
                  <div className="dx-v dx-mono">{String(value)}</div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Railway admin */}
      <div className="dx-card" style={{ marginTop: 14 }}>
        <div className="dx-card-in">
          <div className="dx-card-title">Railway Admin Login</div>
          <div className="dx-codeBox" style={{ marginTop: 10 }}>
            <a href={ADMIN_LOGIN_URL} target="_blank" rel="noreferrer">
              {ADMIN_LOGIN_URL}
            </a>
          </div>
        </div>
      </div>

      <div className="dx-muted" style={{ marginTop: 12 }}>
        Last updated: {lastUpdated ?? "-"}
      </div>
    </div>
  );

  }
