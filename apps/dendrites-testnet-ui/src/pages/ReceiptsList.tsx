import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { listReceipts } from "../lib/receiptsApi";

export default function ReceiptsList() {
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [myOnly, setMyOnly] = useState(false);

  const fetchList = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listReceipts({
        limit: 50,
        wallet: myOnly && address ? address : undefined,
      });
      setItems(data ?? []);
    } catch (err: any) {
      setError(err?.message || "Failed to load receipts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myOnly, address]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => {
      const rid = String(item.receipt_id ?? "").toLowerCase();
      const tx = String(item.tx_hash ?? "").toLowerCase();
      const uop = String(item.userop_hash ?? "").toLowerCase();
      return rid.includes(term) || tx.includes(term) || uop.includes(term);
    });
  }, [items, search]);

  const shorten = (value: string) => {
    if (!value || value.length < 10) return value;
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  };

  const copy = async (value: string) => {
    if (!value) return false;
    try {
      await navigator.clipboard?.writeText(value);
      return true;
    } catch {
      return false;
    }
  };

  const shareReceipt = async (receiptId: string) => {
    if (!receiptId) return;
    const url = `${window.location.origin}/r/${receiptId}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "QuickPay Receipt", url });
        return;
      }
    } catch {
      // fall back to copy/open
    }
    const copied = await copy(url);
    if (!copied) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const formatAmount = (raw: string | null, decimals: number | null, symbol?: string | null) => {
    if (!raw) return "";
    const resolvedDecimals = decimals ?? 18;
    try {
      const formatted = formatUnits(BigInt(raw), resolvedDecimals);
      const [whole, fraction = ""] = formatted.split(".");
      if (!fraction) return `${whole} ${symbol ?? "TOKEN"}`.trim();
      let trimmed = fraction.slice(0, 6).replace(/0+$/, "");
      if (!trimmed) return `${whole} ${symbol ?? "TOKEN"}`.trim();
      return `${whole}.${trimmed} ${symbol ?? "TOKEN"}`.trim();
    } catch {
      return `${raw} ${symbol ?? "TOKEN"}`.trim();
    }
  };

  const openSearch = () => {
    const term = search.trim();
    if (!term) return;
    if (term.startsWith("r_")) {
      navigate(`/receipts/${term}`);
      return;
    }
    if (/^0x[0-9a-fA-F]{64}$/.test(term)) {
      navigate(`/receipts?uop=${term}`);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Receipts Explorer</h2>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input
          style={{ width: "100%", maxWidth: 420, padding: 8 }}
          placeholder="Search receiptId / txHash / userOpHash"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button onClick={fetchList} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
        <button onClick={openSearch} disabled={!search.trim()}>
          Open
        </button>
        {isConnected ? (
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={myOnly}
              onChange={(e) => setMyOnly(e.target.checked)}
            />
            My receipts
          </label>
        ) : null}
      </div>
      {error ? <div style={{ color: "#ff7a7a", marginTop: 8 }}>{error}</div> : null}

      <div style={{ marginTop: 16, border: "1px solid #2a2a2a", borderRadius: 8, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          <thead style={{ textAlign: "left" }}>
            <tr style={{ borderBottom: "1px solid #2a2a2a" }}>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Token</th>
              <th style={{ padding: 8 }}>Amount</th>
              <th style={{ padding: 8 }}>Net</th>
              <th style={{ padding: 8 }}>Fee</th>
              <th style={{ padding: 8 }}>To</th>
              <th style={{ padding: 8 }}>Smart Account</th>
              <th style={{ padding: 8 }}>Time</th>
              <th style={{ padding: 8 }}>ReceiptId</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const symbol = item.token_symbol ?? "TOKEN";
              const decimals = item.token_decimals ?? 18;
              const amountRaw = item.amount_raw ?? (item.net_amount_raw && item.fee_amount_raw
                ? (BigInt(item.net_amount_raw) + BigInt(item.fee_amount_raw)).toString()
                : null);
              const to = item.to ?? "";
              const sender = item.sender ?? "";
              const receiptId = item.receipt_id ?? "";
              const recipientsCount = item.recipients_count ?? (Array.isArray(item.meta?.recipients) ? item.meta.recipients.length : null);
              const isBulk = Number(recipientsCount ?? 0) > 1;
              return (
                <tr
                  key={item.id ?? receiptId}
                  style={{ borderBottom: "1px solid #1f1f1f", cursor: "pointer" }}
                  onClick={() => receiptId && navigate(`/receipts/${receiptId}`)}
                >
                  <td style={{ padding: 8 }}>{item.status ?? ""}</td>
                  <td style={{ padding: 8 }}>
                    {symbol}
                    {item.token ? (
                      <div style={{ color: "#bdbdbd", fontSize: 12 }}>{shorten(item.token)}</div>
                    ) : null}
                  </td>
                  <td style={{ padding: 8 }}>{formatAmount(amountRaw, decimals, symbol)}</td>
                  <td style={{ padding: 8 }}>{formatAmount(item.net_amount_raw, decimals, symbol)}</td>
                  <td style={{ padding: 8 }}>{formatAmount(item.fee_amount_raw, decimals, symbol)}</td>
                  <td style={{ padding: 8 }}>
                    {isBulk ? (
                      <span>Bulk ({recipientsCount})</span>
                    ) : (
                      <>
                        {shorten(to)}
                        {to ? (
                          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                copy(to);
                              }}
                            >
                              Copy
                            </button>
                            <a
                              href={`https://sepolia.basescan.org/address/${to}`}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              BaseScan
                            </a>
                          </div>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td style={{ padding: 8 }}>
                    {shorten(sender)}
                    {sender ? (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            copy(sender);
                          }}
                        >
                          Copy
                        </button>
                        <a
                          href={`https://sepolia.basescan.org/address/${sender}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          BaseScan
                        </a>
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: 8 }}>
                    {item.created_at ? new Date(item.created_at).toLocaleString() : ""}
                  </td>
                  <td style={{ padding: 8 }}>{receiptId}</td>
                  <td style={{ padding: 8 }}>
                    {receiptId ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          shareReceipt(receiptId);
                        }}
                      >
                        Share
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: 12, color: "#bdbdbd" }}>
                  {loading ? "Loading..." : "No receipts found."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
