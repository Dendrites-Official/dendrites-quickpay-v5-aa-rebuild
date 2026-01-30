import { ethers } from "ethers";
import { createTtlCache } from "./cache.js";
import { getRpcTimeoutMs, withTimeout } from "./withTimeout.js";
import { normalizeSpeed } from "./normalizeSpeed.js";
import { resolveRpcUrl } from "./resolveRpcUrl.js";

const PAYMASTER_ABI = [
  "function quoteFeeUsd6(address payer,uint8 mode,uint8 speed,uint256 nowTs) view returns (uint256,uint256,uint256,uint256,uint256,bool)",
  "function feeTokenDecimals(address token) view returns (uint8)",
  "function usd6PerWholeToken(address token) view returns (uint256)",
];

const FACTORY_ABI = [
  "function getAddress(address owner, uint256 salt) view returns (address)",
];

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
];


const TOKEN_META_TTL_MS = 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const ALLOWANCE_TTL_MS = 15 * 1000;

const tokenMetaCache = createTtlCache({ ttlMs: TOKEN_META_TTL_MS, maxSize: 2000 });
const codeCache = createTtlCache({ ttlMs: CODE_TTL_MS, maxSize: 5000 });
const allowanceCache = createTtlCache({ ttlMs: ALLOWANCE_TTL_MS, maxSize: 10000 });

async function getCodeCached(provider, address) {
  const key = String(address).toLowerCase();
  const cached = codeCache.get(key);
  if (cached != null) return cached;
  const code = await withTimeout(provider.getCode(address), getRpcTimeoutMs(), {
    code: "RPC_TIMEOUT",
    status: 504,
    where: "quote.getCode",
    message: "RPC timeout",
  });
  const exists = typeof code === "string" && code !== "0x";
  codeCache.set(key, exists);
  return exists;
}

async function getAllowanceCached(provider, token, owner, spender) {
  const key = `${String(token).toLowerCase()}:${String(owner).toLowerCase()}:${String(spender).toLowerCase()}`;
  const cached = allowanceCache.get(key);
  if (cached != null) return cached;
  const tokenContract = new ethers.Contract(token, ERC20_ABI, provider);
  const allowance = await withTimeout(tokenContract.allowance(owner, spender), getRpcTimeoutMs(), {
    code: "RPC_TIMEOUT",
    status: 504,
    where: "quote.allowance",
    message: "RPC timeout",
  });
  allowanceCache.set(key, allowance);
  return allowance;
}

function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}

function parseList(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
  );
}

function selectLane(token, { eip3009Tokens, eip2612Tokens }) {
  const tokenLower = String(token).toLowerCase();
  if (eip3009Tokens.has(tokenLower)) return "EIP3009";
  if (eip2612Tokens.has(tokenLower)) return "EIP2612";
  return "PERMIT2";
}

export async function getQuote({
  chainId,
  rpcUrl,
  bundlerUrl,
  paymaster,
  factoryAddress,
  router,
  permit2,
  ownerEoa,
  token,
  amount,
  feeMode,
  speed,
  mode,
  maxFeeUsd6,
  eip3009Tokens,
  eip2612Tokens,
  logger,
}) {
  const modeNorm = String(mode ?? "").toUpperCase();
  const resolvedChainId = chainId ?? 84532;
  const isSelfPay = modeNorm === "SELF_PAY";
  const amountStr = typeof amount === "string" || typeof amount === "number" ? String(amount) : "";
  const { canonicalSpeed, canonicalFeeMode } = normalizeSpeed({ feeMode, speed });
  const envErrors = {};
  const reqErrors = {};

  const resolvedRpcUrl = rpcUrl
    ? await resolveRpcUrl({ rpcUrl, bundlerUrl, chainId: resolvedChainId })
    : null;
  const provider = resolvedRpcUrl ? new ethers.JsonRpcProvider(resolvedRpcUrl) : null;
  let smartSender = null;
  let smartDeployed = false;
  const setupNeeded = [];

  if (!isSelfPay) {
    if (!rpcUrl) envErrors.RPC_URL = "missing";
    if (!paymaster) envErrors.PAYMASTER = "missing";
    if (paymaster && !ethers.isAddress(paymaster)) envErrors.PAYMASTER = "invalid_address";
  }

  if (!ownerEoa || !ethers.isAddress(ownerEoa)) reqErrors.ownerEoa = "invalid_address";
  if (!token || !ethers.isAddress(token)) reqErrors.token = "invalid_address";
  if (!/^[0-9]+$/.test(amountStr)) reqErrors.amount = "expected_integer_string";

  // fee mode
  if (feeMode != null && feeMode !== "" && !/^(eco|instant)$/i.test(String(feeMode))) {
    return { ok: false, error: "invalid_request", details: { feeMode: "expected_eco_or_instant" }, statusCode: 400 };
  }

  if (modeNorm && modeNorm !== "SELF_PAY" && modeNorm !== "SPONSORED") reqErrors.mode = "invalid";

  const debug = {
    env: {
      rpcUrl: Boolean(resolvedRpcUrl),
      paymaster: Boolean(paymaster),
      eip3009Tokens: Boolean(eip3009Tokens),
      eip2612Tokens: Boolean(eip2612Tokens),
    },
    parsed: {
      feeMode: canonicalFeeMode,
      speed: canonicalSpeed,
      amountNum: Number(amountStr),
    },
  };
  logger?.info?.("QUOTE_DEBUG", debug);
  logger?.info?.("NORMALIZED_SPEED", {
    feeMode: feeMode ?? "",
    speedIn: speed ?? "",
    speedOut: canonicalSpeed,
  });

  if (Object.keys(envErrors).length) {
    return { ok: false, error: "invalid_config", details: envErrors, statusCode: 400 };
  }
  if (Object.keys(reqErrors).length) {
    return { ok: false, error: "invalid_request", details: reqErrors, statusCode: 400 };
  }

  if (!isSelfPay) {
    if (provider && factoryAddress && ethers.isAddress(factoryAddress) && ownerEoa && ethers.isAddress(ownerEoa)) {
      const factoryAddr = ethers.getAddress(factoryAddress);
      const ownerAddr = ethers.getAddress(ownerEoa);
      const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, provider);
      smartSender = await withTimeout(factory["getAddress(address,uint256)"](ownerAddr, 0n), getRpcTimeoutMs(), {
        code: "RPC_TIMEOUT",
        status: 504,
        where: "quote.getAddress",
        message: "RPC timeout",
      });
      smartDeployed = await getCodeCached(provider, smartSender);
    }

    if (provider && token && ethers.isAddress(token)) {
      const tokenAddr = ethers.getAddress(token);
      if (permit2 && ethers.isAddress(permit2) && ownerEoa && ethers.isAddress(ownerEoa) && router && ethers.isAddress(router)) {
        const amount = BigInt(amountStr);
        const erc20Allowance = await getAllowanceCached(
          provider,
          tokenAddr,
          ethers.getAddress(ownerEoa),
          ethers.getAddress(permit2)
        );
        if (BigInt(erc20Allowance ?? 0n) < amount) {
          setupNeeded.push("permit2_allowance_missing");
        }
      }
      if (smartDeployed && smartSender && router && ethers.isAddress(router)) {
        const allowance = await getAllowanceCached(
          provider,
          tokenAddr,
          smartSender,
          ethers.getAddress(router)
        );
        if (allowance === 0n) setupNeeded.push("aa_allowance_missing");
      }
    }
  }

  if (isSelfPay) {
    return {
      ok: true,
      sponsored: false,
      lane: "SELF_PAY",
      feeUsd6: "0",
      feeTokenAmount: "0",
      netAmount: String(amount),
      feeTokenMode: "same",
      feeMode: canonicalFeeMode,
      speed: canonicalSpeed,
      smartSender: null,
      smartDeployed: null,
      firstTxSurchargePaid: true,
      setupNeeded: [],
      router,
      permit2,
    };
  }

  const paymasterContract = new ethers.Contract(ethers.getAddress(paymaster), PAYMASTER_ABI, provider);
  const nowTs = Math.floor(Date.now() / 1000);
  const payerForQuote = smartSender || ownerEoa;
  const quoteRaw = await withTimeout(
    paymasterContract.quoteFeeUsd6(payerForQuote, 0, canonicalSpeed, nowTs),
    getRpcTimeoutMs(),
    {
      code: "RPC_TIMEOUT",
      status: 504,
      where: "quote.quoteFeeUsd6",
      message: "RPC timeout",
    }
  );
  const baselineUsd6 = BigInt(quoteRaw[0]);
  const firstTxSurchargeUsd6 = BigInt(quoteRaw[1]);
  const finalFeeUsd6 = BigInt(quoteRaw[2]);
  const capBps = BigInt(quoteRaw[3]);
  const firstTxSurchargeApplies = Boolean(quoteRaw[5]);
  const surchargeUsd6 = firstTxSurchargeApplies ? firstTxSurchargeUsd6 : 0n;
  const feeUsd6Final = baselineUsd6 + surchargeUsd6;
  const totalUsd6 = feeUsd6Final;
  const requestMaxFeeUsd6Raw = maxFeeUsd6 != null ? String(maxFeeUsd6).trim() : "";
  const envMaxFeeUsd6Raw = String(
    process.env.MAX_FEE_USDC6 || process.env.MAX_FEE_USD6 || process.env.MAX_FEE_USDC || ""
  ).trim();
  const maxFeeUsd6UsedRaw = requestMaxFeeUsd6Raw || envMaxFeeUsd6Raw || "1000000";
  if (!/^\d+$/.test(maxFeeUsd6UsedRaw)) {
    return {
      ok: false,
      error: "invalid_request",
      details: { maxFeeUsd6: "expected_integer_string" },
      statusCode: 400,
    };
  }
  const maxFeeUsd6Used = BigInt(maxFeeUsd6UsedRaw);

  if (maxFeeUsd6Used < feeUsd6Final) {
    return {
      ok: false,
      error: "MAX_FEE_TOO_LOW",
      feeUsd6: feeUsd6Final.toString(),
      maxFeeUsd6: maxFeeUsd6Used.toString(),
      requiredMinMaxFeeUsd6: feeUsd6Final.toString(),
      statusCode: 400,
    };
  }

  logger?.info?.("QUOTE_INVARIANTS", {
    feeUsd6: feeUsd6Final.toString(),
    maxFeeUsd6: maxFeeUsd6Used.toString(),
    finalFeeUsd6: finalFeeUsd6.toString(),
  });

  const metaKey = `${resolvedChainId}:${String(token).toLowerCase()}`;
  const cachedMeta = tokenMetaCache.get(metaKey);
  const tokenMeta = cachedMeta
    ? cachedMeta
    : {
        decimals: Number(
          await withTimeout(paymasterContract.feeTokenDecimals(token), getRpcTimeoutMs(), {
            code: "RPC_TIMEOUT",
            status: 504,
            where: "quote.feeTokenDecimals",
            message: "RPC timeout",
          })
        ),
        price: BigInt(
          await withTimeout(paymasterContract.usd6PerWholeToken(token), getRpcTimeoutMs(), {
            code: "RPC_TIMEOUT",
            status: 504,
            where: "quote.usd6PerWholeToken",
            message: "RPC timeout",
          })
        ),
      };

  if (!cachedMeta) {
    tokenMetaCache.set(metaKey, tokenMeta);
  }

  const decimals = tokenMeta.decimals;
  const price = tokenMeta.price;
  const pow10 = 10n ** BigInt(decimals);
  const feeTokenAmount = ceilDiv(totalUsd6 * pow10, price);
  const netAmount = (BigInt(amount) - feeTokenAmount).toString();
  const lane = selectLane(token, {
    eip3009Tokens: parseList(eip3009Tokens),
    eip2612Tokens: parseList(eip2612Tokens),
  });

  return {
    ok: true,
    sponsored: true,
    lane,
    feeUsd6: totalUsd6.toString(),
    feeTokenAmount: feeTokenAmount.toString(),
    maxFeeUsd6: maxFeeUsd6Used.toString(),
    baselineUsd6: baselineUsd6.toString(),
    surchargeUsd6: surchargeUsd6.toString(),
    capBps: capBps.toString(),
    firstTxSurchargeApplies,
    netAmount,
    feeTokenMode: "same",
    feeMode: canonicalFeeMode,
    speed: canonicalSpeed,
    smartSender,
    smartDeployed,
    firstTxSurchargePaid: !firstTxSurchargeApplies,
    setupNeeded,
    router,
    permit2,
  };
}
