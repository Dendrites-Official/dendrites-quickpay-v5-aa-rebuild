import { ethers } from "ethers";

const DEFAULT_CACHE_TTL_MS = 30000;
const TOKEN_SCAN_CONCURRENCY = 5;
const DEFAULT_MAX_TOKENS = 30;
const TOKEN_TX_OFFSET = 200;
const RPC_TIMEOUT_MS = 6000;

const cache = new Map();

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function getCacheKey({ address, page, offset, sort, chainId, action }) {
  return `${action}_${address.toLowerCase()}_${chainId}_${page}_${offset}_${sort}`;
}

function resolveExplorerConfig(chainId) {
  if (chainId === 8453) {
    return {
      apiBase: String(process.env.BLOCKSCOUT_BASE_MAINNET_API_URL || "").trim(),
      explorerBaseUrl: String(process.env.BLOCKSCOUT_BASE_MAINNET_EXPLORER_BASE_URL || "").trim(),
    };
  }
  if (chainId === 84532) {
    return {
      apiBase: String(process.env.BLOCKSCOUT_BASE_SEPOLIA_API_URL || "").trim(),
      explorerBaseUrl: String(process.env.BLOCKSCOUT_BASE_SEPOLIA_EXPLORER_BASE_URL || "").trim(),
    };
  }
  return null;
}

function resolveRpcUrl(chainId) {
  if (chainId === 8453) {
    return String(process.env.RPC_URL_BASE_MAINNET || process.env.RPC_URL || "").trim();
  }
  if (chainId === 84532) {
    return String(process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL || "").trim();
  }
  return String(process.env.RPC_URL || "").trim();
}

function getEnvList(name) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v));
    } catch {
      return [];
    }
  }
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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

function mapTokenTx(tx) {
  return {
    hash: tx.hash,
    tokenAddress: tx.contractAddress,
    tokenName: tx.tokenName,
    tokenSymbol: tx.tokenSymbol,
    tokenDecimal: tx.tokenDecimal,
    from: tx.from,
    to: tx.to,
    value: tx.value,
    timeStamp: tx.timeStamp,
  };
}

async function fetchExplorerData({
  address,
  chainId,
  page,
  offset,
  sort,
  action,
}) {
  const explorerConfig = resolveExplorerConfig(chainId);
  if (!explorerConfig) {
    const err = new Error("ACTIVITY_UNSUPPORTED_CHAIN");
    err.statusCode = 400;
    throw err;
  }
  const { apiBase, explorerBaseUrl } = explorerConfig;
  if (!apiBase) {
    const err = new Error("ACTIVITY_NOT_CONFIGURED");
    err.statusCode = 501;
    throw err;
  }

  const url = new URL(apiBase);
  url.searchParams.set("module", "account");
  url.searchParams.set("action", action);
  url.searchParams.set("address", String(address));
  url.searchParams.set("page", String(page));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("sort", sort);

  let data;
  let resStatus = 0;
  try {
    const res = await fetch(url.toString());
    resStatus = res.status;
    if (res.status === 429) {
      const err = new Error("RATE_LIMIT");
      err.statusCode = 429;
      throw err;
    }
    data = await res.json();
  } catch (err) {
    if (err?.statusCode) throw err;
    const failure = new Error("EXPLORER_ERROR");
    failure.statusCode = 502;
    failure.details = "fetch_failed";
    throw failure;
  }

  const message = String(data?.message || "").toLowerCase();
  const result = data?.result;
  const rateLimited =
    message.includes("rate limit") ||
    String(result || "").toLowerCase().includes("rate limit") ||
    String(result || "").toLowerCase().includes("max rate limit");

  if (rateLimited) {
    const err = new Error("RATE_LIMIT");
    err.statusCode = 429;
    throw err;
  }

  if (data?.status === "0" && message.includes("no transactions")) {
    return { explorerBaseUrl, items: [] };
  }

  if (!Array.isArray(result)) {
    const err = new Error("EXPLORER_ERROR");
    err.statusCode = 502;
    err.details = data?.result || data?.message || `status_${resStatus}`;
    throw err;
  }

  return { explorerBaseUrl, items: result };
}

async function handleApprovalsScan(request, reply) {
  const body = request.body ?? {};
  const chainId = Number(body?.chainId);
  const owner = String(body?.owner || "").trim();
  const maxTokensInput = Number(body?.maxTokens);

  if (![8453, 84532].includes(chainId)) {
    return reply.code(400).send({ ok: false, error: "UNSUPPORTED_CHAIN", code: "UNSUPPORTED_CHAIN" });
  }
  if (!isAddress(owner)) {
    return reply.code(400).send({ ok: false, error: "INVALID_OWNER", code: "INVALID_OWNER" });
  }

  const spendersInput = Array.isArray(body?.spenders) ? body.spenders : null;
  const envSpenders = getEnvList("APPROVAL_SCAN_SPENDERS");
  const fallbackSpenders = [process.env.PERMIT2, process.env.ROUTER]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const spenders = (spendersInput ?? (envSpenders.length ? envSpenders : fallbackSpenders))
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (!spenders.length) {
    return reply.code(501).send({
      ok: false,
      error: "SCANNER_NOT_CONFIGURED",
      code: "SCANNER_NOT_CONFIGURED",
      details: "No spenders configured for approvals scan.",
    });
  }
  if (!spenders.every(isAddress)) {
    return reply.code(400).send({ ok: false, error: "INVALID_SPENDERS", code: "INVALID_SPENDERS" });
  }

  const rpcUrl = resolveRpcUrl(chainId);
  if (!rpcUrl) {
    return reply.code(500).send({ ok: false, error: "RPC_NOT_CONFIGURED", code: "RPC_NOT_CONFIGURED" });
  }

  const maxTokens = Number.isFinite(maxTokensInput) && maxTokensInput > 0 ? Math.min(maxTokensInput, 100) : DEFAULT_MAX_TOKENS;

  let tokenTxItems = [];
  try {
    const { items } = await fetchExplorerData({
      address: owner,
      chainId,
      page: 1,
      offset: TOKEN_TX_OFFSET,
      sort: "desc",
      action: "tokentx",
    });
    tokenTxItems = items;
  } catch (err) {
    const status = err?.statusCode || 502;
    const error = err?.message || "EXPLORER_ERROR";
    const details = err?.details ? String(err.details) : undefined;
    return reply.code(status).send({ ok: false, error, code: error, details });
  }

  if (!Array.isArray(tokenTxItems) || tokenTxItems.length === 0) {
    return reply.send({ ok: true, chainId, owner, spenders, tokens: [] });
  }

  const tokenMetaByAddress = new Map();
  const tokens = [];
  for (const item of tokenTxItems) {
    const tokenAddress = String(item?.contractAddress || "").trim();
    if (!isAddress(tokenAddress)) continue;
    if (tokenMetaByAddress.has(tokenAddress.toLowerCase())) continue;
    tokenMetaByAddress.set(tokenAddress.toLowerCase(), {
      tokenAddress,
      tokenDecimal: item?.tokenDecimal,
      tokenSymbol: item?.tokenSymbol,
    });
    tokens.push(tokenAddress);
    if (tokens.length >= maxTokens) break;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
  const erc20Abi = [
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function allowance(address owner, address spender) view returns (uint256)",
  ];

  const results = [];
  let index = 0;

  const runNext = async () => {
    while (index < tokens.length) {
      const tokenAddress = tokens[index++];
      const metaHint = tokenMetaByAddress.get(tokenAddress.toLowerCase()) || {};
      const entry = {
        tokenAddress,
        symbol: metaHint.tokenSymbol || null,
        decimals: null,
        allowances: [],
        error: null,
      };

      try {
        const contract = new ethers.Contract(tokenAddress, erc20Abi, provider);
        let decimals = null;
        let symbol = entry.symbol;

        try {
          const dec = await withTimeout(contract.decimals(), RPC_TIMEOUT_MS);
          decimals = Number(dec);
        } catch {
          const fallback = Number(metaHint.tokenDecimal);
          decimals = Number.isFinite(fallback) ? fallback : null;
        }

        if (!symbol) {
          try {
            symbol = String(await withTimeout(contract.symbol(), RPC_TIMEOUT_MS));
          } catch {
            symbol = metaHint.tokenSymbol || null;
          }
        }

        entry.decimals = decimals;
        entry.symbol = symbol;

        for (const spender of spenders) {
          try {
            const allowance = await withTimeout(contract.allowance(owner, spender), RPC_TIMEOUT_MS);
            const allowanceStr = allowance?.toString?.() ?? "0";
            entry.allowances.push({
              spender,
              allowance: allowanceStr,
              isUnlimited: BigInt(allowanceStr) >= ethers.MaxUint256 / 2n,
            });
          } catch {
            entry.allowances.push({
              spender,
              allowance: "0",
              isUnlimited: false,
              error: "allowance_failed",
            });
          }
        }
      } catch (err) {
        entry.error = String(err?.message || "token_failed");
      }

      results.push(entry);
    }
  };

  const workers = Array.from({ length: Math.min(TOKEN_SCAN_CONCURRENCY, tokens.length) }, () => runNext());
  await Promise.all(workers);

  return reply.send({
    ok: true,
    chainId,
    owner,
    spenders,
    tokens: results,
  });
}

export function registerWalletRoutes(app) {
  app.get("/wallet/probe", async (_request, reply) => {
    const mainnetApi = String(process.env.BLOCKSCOUT_BASE_MAINNET_API_URL || "").trim();
    const mainnetExplorer = String(process.env.BLOCKSCOUT_BASE_MAINNET_EXPLORER_BASE_URL || "").trim();
    const sepoliaApi = String(process.env.BLOCKSCOUT_BASE_SEPOLIA_API_URL || "").trim();
    const sepoliaExplorer = String(process.env.BLOCKSCOUT_BASE_SEPOLIA_EXPLORER_BASE_URL || "").trim();

    return reply.send({
      ok: true,
      chainSupport: {
        8453: true,
        84532: true,
      },
      blockscoutConfigured: {
        8453: Boolean(mainnetApi && mainnetExplorer),
        84532: Boolean(sepoliaApi && sepoliaExplorer),
      },
      now: new Date().toISOString(),
    });
  });

  app.get("/wallet/activity/txlist", async (request, reply) => {
    const { address, chainId, page = "1", offset = "50", sort = "desc" } = request.query || {};

    if (!isAddress(address)) {
      return reply.code(400).send({ ok: false, error: "INVALID_ADDRESS" });
    }

    const pageNum = Math.max(1, Number.parseInt(String(page), 10) || 1);
    const offsetNumRaw = Number.parseInt(String(offset), 10) || 50;
    const offsetNum = Math.min(Math.max(1, offsetNumRaw), 100);
    const sortValue = String(sort || "desc").toLowerCase() === "asc" ? "asc" : "desc";

    const chain = Number.parseInt(String(chainId ?? process.env.CHAIN_ID ?? 84532), 10);
    const cacheKey = getCacheKey({
      address,
      page: pageNum,
      offset: offsetNum,
      sort: sortValue,
      chainId: chain,
      action: "txlist",
    });
    const cached = getCached(cacheKey);
    if (cached) {
      return reply.send(cached);
    }
    try {
      const { explorerBaseUrl, items } = await fetchExplorerData({
        address,
        chainId: chain,
        page: pageNum,
        offset: offsetNum,
        sort: sortValue,
        action: "txlist",
      });

      const payload = {
        ok: true,
        explorerBaseUrl,
        items: items.map(mapTx),
      };

      setCached(cacheKey, payload, getCacheTtlMs());
      return reply.send(payload);
    } catch (err) {
      const status = err?.statusCode || 502;
      const error = err?.message || "EXPLORER_ERROR";
      const details = err?.details ? String(err.details) : undefined;
      return reply.code(status).send({ ok: false, error, details });
    }
  });

  app.get("/wallet/activity/tokentx", async (request, reply) => {
    const { address, chainId, page = "1", offset = "100", sort = "desc" } = request.query || {};

    if (!isAddress(address)) {
      return reply.code(400).send({ ok: false, error: "INVALID_ADDRESS" });
    }

    const chain = Number.parseInt(String(chainId ?? ""), 10);
    if (![8453, 84532].includes(chain)) {
      return reply.code(400).send({ ok: false, error: "UNSUPPORTED_CHAIN" });
    }

    const pageNum = Math.max(1, Number.parseInt(String(page), 10) || 1);
    const offsetNumRaw = Number.parseInt(String(offset), 10) || 100;
    const offsetNum = Math.min(Math.max(1, offsetNumRaw), 100);
    const sortValue = String(sort || "desc").toLowerCase() === "asc" ? "asc" : "desc";

    const cacheKey = getCacheKey({
      address,
      page: pageNum,
      offset: offsetNum,
      sort: sortValue,
      chainId: chain,
      action: "tokentx",
    });
    const cached = getCached(cacheKey);
    if (cached) {
      return reply.send(cached);
    }
    try {
      const { explorerBaseUrl, items } = await fetchExplorerData({
        address,
        chainId: chain,
        page: pageNum,
        offset: offsetNum,
        sort: sortValue,
        action: "tokentx",
      });

      const payload = {
        ok: true,
        explorerBaseUrl,
        items: items.map(mapTokenTx),
      };

      setCached(cacheKey, payload, getCacheTtlMs());
      return reply.send(payload);
    } catch (err) {
      const status = err?.statusCode || 502;
      const error = err?.message || "EXPLORER_ERROR";
      const details = err?.details ? String(err.details) : undefined;
      return reply.code(status).send({ ok: false, error, details });
    }
  });

  app.post("/wallet/approvals/scan", handleApprovalsScan);
  app.post("/wallet/approvals/scan-v2", handleApprovalsScan);
  app.post("/wallet/approvals_scan", handleApprovalsScan);
}
