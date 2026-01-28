const DEFAULT_CACHE_TTL_MS = 30000;

const cache = new Map();

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function getCacheKey({ address, page, offset, sort }) {
  return `${address.toLowerCase()}_${page}_${offset}_${sort}`;
}

function getCacheTtlMs() {
  const raw = Number(process.env.ACTIVITY_CACHE_TTL_MS ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CACHE_TTL_MS;
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function mapTx(tx) {
  return {
    hash: tx.hash,
    nonce: tx.nonce,
    from: tx.from,
    to: tx.to,
    timeStamp: tx.timeStamp,
    isError: tx.isError,
    txreceipt_status: tx.txreceipt_status,
    value: tx.value,
    gasPrice: tx.gasPrice,
    gasUsed: tx.gasUsed,
    blockNumber: tx.blockNumber,
  };
}

export function registerWalletRoutes(app) {
  app.get("/wallet/activity/txlist", async (request, reply) => {
    const { address, page = "1", offset = "50", sort = "desc" } = request.query || {};

    if (!isAddress(address)) {
      return reply.code(400).send({ ok: false, error: "INVALID_ADDRESS" });
    }

    const pageNum = Math.max(1, Number.parseInt(String(page), 10) || 1);
    const offsetNumRaw = Number.parseInt(String(offset), 10) || 50;
    const offsetNum = Math.min(Math.max(1, offsetNumRaw), 100);
    const sortValue = String(sort || "desc").toLowerCase() === "asc" ? "asc" : "desc";

    const cacheKey = getCacheKey({ address, page: pageNum, offset: offsetNum, sort: sortValue });
    const cached = getCached(cacheKey);
    if (cached) {
      return reply.send(cached);
    }

    const apiBase = String(process.env.BASESCAN_API_URL || "").trim();
    const apiKey = String(process.env.BASESCAN_API_KEY || "").trim();
    const explorerBaseUrl = String(process.env.BASESCAN_EXPLORER_BASE_URL || "").trim();

    if (!apiBase || !apiKey) {
      return reply.code(501).send({ ok: false, error: "ACTIVITY_NOT_CONFIGURED" });
    }

    const url = new URL(apiBase);
    url.searchParams.set("module", "account");
    url.searchParams.set("action", "txlist");
    url.searchParams.set("address", String(address));
    url.searchParams.set("page", String(pageNum));
    url.searchParams.set("offset", String(offsetNum));
    url.searchParams.set("sort", sortValue);
    url.searchParams.set("apikey", apiKey);

    let data;
    try {
      const res = await fetch(url.toString());
      if (res.status === 429) {
        return reply.code(429).send({ ok: false, error: "RATE_LIMIT" });
      }
      data = await res.json();
    } catch {
      return reply.code(502).send({ ok: false, error: "EXPLORER_ERROR" });
    }

    const message = String(data?.message || "").toLowerCase();
    const result = data?.result;
    const rateLimited =
      message.includes("rate limit") ||
      String(result || "").toLowerCase().includes("rate limit") ||
      String(result || "").toLowerCase().includes("max rate limit");

    if (rateLimited) {
      return reply.code(429).send({ ok: false, error: "RATE_LIMIT" });
    }

    if (data?.status === "0" && message.includes("no transactions")) {
      const payload = { ok: true, explorerBaseUrl, items: [] };
      setCached(cacheKey, payload, getCacheTtlMs());
      return reply.send(payload);
    }

    if (!Array.isArray(result)) {
      return reply.code(502).send({ ok: false, error: "EXPLORER_ERROR" });
    }

    const payload = {
      ok: true,
      explorerBaseUrl,
      items: result.map(mapTx),
    };

    setCached(cacheKey, payload, getCacheTtlMs());
    return reply.send(payload);
  });
}
