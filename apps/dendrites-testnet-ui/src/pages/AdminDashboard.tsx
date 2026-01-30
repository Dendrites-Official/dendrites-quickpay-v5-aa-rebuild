import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatUnits } from "ethers";
import { supabase } from "../lib/supabaseClient";

const ADMIN_UI_KEY = String(import.meta.env.VITE_ADMIN_UI_KEY ?? "").trim();
const USDC_ADDRESS = String(import.meta.env.VITE_USDC_ADDRESS ?? "").trim().toLowerCase();
const MDNDX_ADDRESS = String(import.meta.env.VITE_MDNDX_ADDRESS ?? "").trim().toLowerCase();
const MAX_SAMPLE = 10000;

type Metrics = {
  total: number;
  successRate: number;
  daw: number;
  p95: number | null;
  topErrors: Array<{ code: string; count: number }>;
  sampled: boolean;
};

type Snapshot = {
  ts: string;
  chain_id: number;
  paymaster_deposit_wei: string | null;
  fee_vault_balances: Record<string, string | null>;
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

export default function AdminDashboard() {
  const [keyInput, setKeyInput] = useState(() => {
    const urlKey = new URLSearchParams(window.location.search).get("key") ?? "";
    return urlKey || localStorage.getItem("adminKey") || "";
  });
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const tokenDecimals = useMemo(() => {
    const map = new Map<string, number>();
    if (USDC_ADDRESS) map.set(USDC_ADDRESS, 6);
    if (MDNDX_ADDRESS) map.set(MDNDX_ADDRESS, 18);
    return map;
  }, []);

  useEffect(() => {
    if (!ADMIN_UI_KEY) {
      setUnlocked(true);
      return;
    }
    const ok = keyInput.trim() === ADMIN_UI_KEY;
    setUnlocked(ok);
    if (ok && keyInput.trim()) {
      localStorage.setItem("adminKey", keyInput.trim());
    }
  }, [keyInput]);

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
        .select("ts,chain_id,paymaster_deposit_wei,fee_vault_balances")
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (snapError) throw snapError;

      setMetrics({
        total,
        successRate: total ? success / total : 0,
        daw: wallets.size,
        p95: p95 ?? null,
        topErrors,
        sampled: total > MAX_SAMPLE,
      });
      setSnapshot((snap as Snapshot) ?? null);
      setLastUpdated(new Date().toISOString());
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (unlocked) {
      loadData();
    }
  }, [unlocked, loadData]);

  if (!unlocked) {
    return (
      <div style={{ padding: 24, maxWidth: 680, margin: "0 auto" }}>
        <h2>Admin Dashboard</h2>
        <p style={{ color: "#aaa" }}>Enter the admin key to unlock.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
            placeholder="ADMIN_UI_KEY"
            style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid #333", background: "#111" }}
          />
          <button
            onClick={() => setKeyInput((prev) => prev.trim())}
            style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #333", background: "#222" }}
          >
            Unlock
          </button>
        </div>
        <p style={{ marginTop: 12, color: "#666" }}>
          Tip: You can also open /admin?key=YOUR_KEY.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Admin Dashboard</h2>
        <Link to="/quickpay" style={{ marginLeft: "auto" }}>
          Back to QuickPay
        </Link>
        <button
          onClick={loadData}
          disabled={loading}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #333", background: "#222" }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {!ADMIN_UI_KEY && (
        <div style={{ marginBottom: 12, color: "#caa" }}>
          ADMIN_UI_KEY is not set. Set VITE_ADMIN_UI_KEY to enforce gating.
        </div>
      )}
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
          <div>
            <div style={{ color: "#888", marginBottom: 6 }}>FeeVault Balances</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {snapshot?.fee_vault_balances && Object.keys(snapshot.fee_vault_balances).length ? (
                  Object.entries(snapshot.fee_vault_balances).map(([token, value]) => (
                    <tr key={token}>
                      <td style={{ padding: "4px 0", fontSize: 12 }}>{token}</td>
                      <td style={{ padding: "4px 0", textAlign: "right" }}>
                        {formatBalance(value, tokenDecimals.get(token))}
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

      <div style={{ marginTop: 12, color: "#666" }}>
        Last updated: {lastUpdated ?? "-"}
      </div>
    </div>
  );
}
