import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatUnits } from "viem";
import { useReceiptsData } from "../demo/useReceiptsData";
import { useWalletState } from "../demo/useWalletState";

type SortKey =
  | "status"
  | "token"
  | "amount"
  | "net"
  | "fee"
  | "to"
  | "sender"
  | "time"
  | "receiptId";

type SortDir = "asc" | "desc";

export default function ReceiptsList() {
  const navigate = useNavigate();
  const { address, isConnected } = useWalletState();
  const { isDemo, mergedReceipts, listReceipts } = useReceiptsData();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [myOnly, setMyOnly] = useState(false);

  // Table UX
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const fetchList = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listReceipts({
        limit: 50,
        wallet: myOnly && address ? address : undefined,
      });
      setItems(data ?? []);
      setPage(1);
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

  useEffect(() => {
    if (!isDemo) return;
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, mergedReceipts]);

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
      // fall back
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
      const trimmed = fraction.slice(0, 6).replace(/0+$/, "");
      return trimmed ? `${whole}.${trimmed} ${symbol ?? "TOKEN"}`.trim() : `${whole} ${symbol ?? "TOKEN"}`.trim();
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

  const getBigIntSafe = (v: any) => {
    try {
      if (v === null || v === undefined || v === "") return 0n;
      return BigInt(String(v));
    } catch {
      return 0n;
    }
  };

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;

    const withSortValue = filtered.map((item) => {
      const symbol = item.token_symbol ?? "TOKEN";
      const decimals = item.token_decimals ?? 18;

      const amountRaw =
        item.amount_raw ??
        (item.net_amount_raw && item.fee_amount_raw
          ? (getBigIntSafe(item.net_amount_raw) + getBigIntSafe(item.fee_amount_raw)).toString()
          : null);

      const netRaw = item.net_amount_raw ?? null;
      const feeRaw = item.fee_amount_raw ?? null;

      const createdAt = item.created_at ? new Date(item.created_at).getTime() : 0;

      const receiptId = String(item.receipt_id ?? "");
      const status = String(item.status ?? "");
      const token = String(symbol ?? "");
      const to = String(item.to ?? "");
      const sender = String(item.sender ?? "");

      const sortValue = (() => {
        switch (sortKey) {
          case "status":
            return status.toLowerCase();
          case "token":
            return token.toLowerCase();
          case "to":
            return to.toLowerCase();
          case "sender":
            return sender.toLowerCase();
          case "receiptId":
            return receiptId.toLowerCase();
          case "time":
            return createdAt;
          case "amount":
            return getBigIntSafe(amountRaw);
          case "net":
            return getBigIntSafe(netRaw);
          case "fee":
            return getBigIntSafe(feeRaw);
          default:
            return createdAt;
        }
      })();

      return { item, sortValue, decimals, symbol, amountRaw, netRaw, feeRaw, createdAt, receiptId };
    });

    const cmp = (a: any, b: any) => {
      const av = a.sortValue;
      const bv = b.sortValue;

      // BigInt compare
      if (typeof av === "bigint" && typeof bv === "bigint") {
        if (av === bv) return 0;
        return av > bv ? dir : -dir;
      }

      // number compare
      if (typeof av === "number" && typeof bv === "number") {
        if (av === bv) return 0;
        return av > bv ? dir : -dir;
      }

      // string compare
      const as = String(av ?? "");
      const bs = String(bv ?? "");
      return as.localeCompare(bs) * dir;
    };

    return withSortValue.sort(cmp);
  }, [filtered, sortKey, sortDir]);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const paged = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    const end = start + pageSize;
    return sorted.slice(start, end);
  }, [sorted, safePage, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    setSortKey((prev) => {
      if (prev !== key) return key;
      return prev;
    });
    setSortDir((prev) => {
      if (sortKey !== key) return "desc";
      return prev === "asc" ? "desc" : "asc";
    });
  };

  const sortGlyph = (key: SortKey) => {
    if (sortKey !== key) return "↕";
    return sortDir === "asc" ? "▲" : "▼";
  };

  const renderPageNumbers = () => {
    const maxButtons = 7;
    const pages: number[] = [];

    let start = Math.max(1, safePage - Math.floor(maxButtons / 2));
    let end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);

    for (let p = start; p <= end; p++) pages.push(p);

    return (
      <div className="dx-rowInline" style={{ gap: 8 }}>
        {pages.map((p) => (
          <button
            key={p}
            className={p === safePage ? "dx-miniLink" : "dx-miniBtn"}
            onClick={() => setPage(p)}
            disabled={p === safePage}
          >
            {p}
          </button>
        ))}
      </div>
    );
  };

  return (
    <main className="dx-container dx-container--full">
      <header className="dx-pageHead">
        <div className="dx-kicker">DENDRITES</div>
        <h1 className="dx-h1">Receipts</h1>
        <p className="dx-sub">Explore receipts. Sort columns and paginate locally (UI-only).</p>
      </header>

      <section className="dx-card" style={{ marginTop: 14 }}>
        <div className="dx-card-in">
          <div className="dx-headRow">
            <div>
              <div className="dx-card-title">Receipts Explorer</div>
              <div className="dx-card-hint">Fetched: up to 50</div>
            </div>

            <div className="dx-headMeta">
              <div className="dx-rowInline">
                <span className="dx-muted">Rows</span>
                <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>
          </div>

          <div className="dx-divider" />

          <div className="dx-rowInline" style={{ justifyContent: "space-between" }}>
            <div className="dx-rowInline" style={{ flex: 1, gap: 12, flexWrap: "wrap" }}>
              <input
                style={{ maxWidth: 420 }}
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
                <label className="dx-check">
                  <input type="checkbox" checked={myOnly} onChange={(e) => setMyOnly(e.target.checked)} />
                  My receipts
                </label>
              ) : null}
            </div>

            <div className="dx-muted">
              {total ? `Showing ${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, total)} of ${total}` : "0 results"}
            </div>
          </div>

          {error ? <div className="dx-alert dx-alert-danger" style={{ marginTop: 10 }}>{error}</div> : null}

          <div className="dx-tableWrap">
            <div className="dx-tableScroll">
              <table className="dx-table">
                <thead>
                  <tr>
                    <th className="dx-th">
                      <button className="dx-thBtn" onClick={() => toggleSort("status")}>
                        Status {sortGlyph("status")}
                      </button>
                    </th>
                    <th className="dx-th">
                      <button className="dx-thBtn" onClick={() => toggleSort("token")}>
                        Token {sortGlyph("token")}
                      </button>
                    </th>
                    <th className="dx-th">
                      <button className="dx-thBtn" onClick={() => toggleSort("amount")}>
                        Amount {sortGlyph("amount")}
                      </button>
                    </th>
                    <th className="dx-th">
                      <button className="dx-thBtn" onClick={() => toggleSort("net")}>
                        Net {sortGlyph("net")}
                      </button>
                    </th>
                    <th className="dx-th">
                      <button className="dx-thBtn" onClick={() => toggleSort("fee")}>
                        Fee {sortGlyph("fee")}
                      </button>
                    </th>
                    <th className="dx-th">
                      <button className="dx-thBtn" onClick={() => toggleSort("to")}>
                        To {sortGlyph("to")}
                      </button>
                    </th>
                    <th className="dx-th">
                      <button className="dx-thBtn" onClick={() => toggleSort("sender")}>
                        Smart Account {sortGlyph("sender")}
                      </button>
                    </th>
                    <th className="dx-th">
                      <button className="dx-thBtn" onClick={() => toggleSort("time")}>
                        Time {sortGlyph("time")}
                      </button>
                    </th>
                    <th className="dx-th">
                      <button className="dx-thBtn" onClick={() => toggleSort("receiptId")}>
                        ReceiptId {sortGlyph("receiptId")}
                      </button>
                    </th>
                    <th className="dx-th" />
                  </tr>
                </thead>

                <tbody>
                  {paged.map((row) => {
                    const item = row.item;
                    const symbol = item.token_symbol ?? "TOKEN";
                    const decimals = item.token_decimals ?? 18;

                    const amountRaw =
                      item.amount_raw ??
                      (item.net_amount_raw && item.fee_amount_raw
                        ? (BigInt(item.net_amount_raw) + BigInt(item.fee_amount_raw)).toString()
                        : null);

                    const to = String(item.to ?? "");
                    const sender = String(item.sender ?? "");
                    const receiptId = String(item.receipt_id ?? "");

                    const route = String(item.meta?.route ?? "").toLowerCase();
                    const isAckLink = route.startsWith("acklink_");
                    const ackLinkId = item.meta?.linkId ?? item.meta?.link_id ?? "";
                    const recipientsCount =
                      item.recipients_count ??
                      (Array.isArray(item.meta?.recipients) ? item.meta.recipients.length : null);
                    const isBulk = Number(recipientsCount ?? 0) > 1;

                    return (
                      <tr
                        key={item.id ?? receiptId}
                        className="dx-row"
                        onClick={() => receiptId && navigate(`/receipts/${receiptId}`)}
                      >
                        <td className="dx-td">{item.status ?? ""}</td>

                        <td className="dx-td">
                          {symbol}
                          {item.token ? <div className="dx-subline dx-mono">{shorten(String(item.token))}</div> : null}
                        </td>

                        <td className="dx-td">{formatAmount(amountRaw, decimals, symbol)}</td>
                        <td className="dx-td">{formatAmount(item.net_amount_raw, decimals, symbol)}</td>
                        <td className="dx-td">{formatAmount(item.fee_amount_raw, decimals, symbol)}</td>

                        <td className="dx-td">
                          {isAckLink ? (
                            <span>
                              AckLink
                              {ackLinkId ? <div className="dx-subline dx-mono">{shorten(String(ackLinkId))}</div> : null}
                            </span>
                          ) : isBulk ? (
                            <span>Bulk ({recipientsCount})</span>
                          ) : (
                            <>
                              <div className="dx-mono">{shorten(to)}</div>
                              {to ? (
                                <div className="dx-miniRow">
                                  <button
                                    className="dx-miniBtn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      copy(to);
                                    }}
                                  >
                                    Copy
                                  </button>
                                  <a
                                    className="dx-miniLink"
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

                        <td className="dx-td">
                          <div className="dx-mono">{shorten(sender)}</div>
                          {sender ? (
                            <div className="dx-miniRow">
                              <button
                                className="dx-miniBtn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copy(sender);
                                }}
                              >
                                Copy
                              </button>
                              <a
                                className="dx-miniLink"
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

                        <td className="dx-td">
                          {item.created_at ? new Date(item.created_at).toLocaleString() : ""}
                        </td>

                        <td className="dx-td">
                          <div className="dx-mono">{receiptId}</div>
                        </td>

                        <td className="dx-td">
                          {receiptId ? (
                            <button
                              className="dx-miniBtn"
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

                  {paged.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="dx-td" style={{ color: "rgba(255,255,255,.62)" }}>
                        {loading ? "Loading..." : "No receipts found."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination bottom */}
          <div className="dx-divider" />
          <div className="dx-rowInline" style={{ justifyContent: "space-between" }}>
            <div className="dx-rowInline">
              <button className="dx-miniBtn" onClick={() => setPage(1)} disabled={safePage <= 1}>
                First
              </button>
              <button className="dx-miniBtn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>
                Prev
              </button>
              {renderPageNumbers()}
              <button className="dx-miniBtn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>
                Next
              </button>
              <button className="dx-miniBtn" onClick={() => setPage(totalPages)} disabled={safePage >= totalPages}>
                Last
              </button>
            </div>

            <div className="dx-muted">
              Page {safePage} / {totalPages}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
