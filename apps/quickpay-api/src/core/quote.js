import { ethers } from "ethers";

const PAYMASTER_ABI = [
  "function quoteFeeUsd6(address payer,uint8 mode,uint8 speed,uint256 nowTs) view returns (uint256,uint256,uint256,uint256,uint256,bool)",
  "function feeTokenDecimals(address token) view returns (uint8)",
  "function usd6PerWholeToken(address token) view returns (uint256)",
];

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

function parseSpeed({ feeMode, speed }) {
  if (typeof speed === "number") return speed;
  if (typeof speed === "string") {
    const trimmed = speed.trim().toLowerCase();
    if (trimmed === "") {
      return String(feeMode ?? "eco").toLowerCase() === "instant" ? 1 : 0;
    }
    if (trimmed === "eco") return 0;
    if (trimmed === "instant") return 1;
    return Number(trimmed);
  }
  return String(feeMode ?? "eco").toLowerCase() === "instant" ? 1 : 0;
}

export async function getQuote({
  rpcUrl,
  paymaster,
  ownerEoa,
  token,
  amount,
  feeMode,
  speed,
  mode,
  eip3009Tokens,
  eip2612Tokens,
}) {
  const modeNorm = String(mode ?? "").toUpperCase();
  const isSelfPay = modeNorm === "SELF_PAY";
  const feeModeNorm = String(feeMode ?? "eco").toLowerCase();
  const amountStr = typeof amount === "string" || typeof amount === "number" ? String(amount) : "";
  const speedVal = parseSpeed({ feeMode: feeModeNorm, speed });
  const envErrors = {};
  const reqErrors = {};

  if (!isSelfPay) {
    if (!rpcUrl) envErrors.RPC_URL = "missing";
    if (!paymaster) envErrors.PAYMASTER = "missing";
    if (paymaster && !ethers.isAddress(paymaster)) envErrors.PAYMASTER = "invalid_address";
  }

  if (!ownerEoa || !ethers.isAddress(ownerEoa)) reqErrors.ownerEoa = "invalid_address";
  if (!token || !ethers.isAddress(token)) reqErrors.token = "invalid_address";
  if (!/^[0-9]+$/.test(amountStr)) reqErrors.amount = "expected_integer_string";
  if (!Number.isFinite(speedVal)) reqErrors.speed = "invalid";
  if (!"eco|instant".split("|").includes(feeModeNorm)) reqErrors.feeMode = "expected_eco_or_instant";
  if (modeNorm && modeNorm !== "SELF_PAY" && modeNorm !== "SPONSORED") reqErrors.mode = "invalid";

  const debug = {
    env: {
      rpcUrl: Boolean(rpcUrl),
      paymaster: Boolean(paymaster),
      eip3009Tokens: Boolean(eip3009Tokens),
      eip2612Tokens: Boolean(eip2612Tokens),
    },
    parsed: {
      feeMode: feeModeNorm,
      speed: speedVal,
      amountNum: Number(amountStr),
    },
  };
  console.log("QUOTE_DEBUG", JSON.stringify(debug));

  if (Object.keys(envErrors).length) {
    return { ok: false, error: "invalid_config", details: envErrors, statusCode: 400 };
  }
  if (Object.keys(reqErrors).length) {
    return { ok: false, error: "invalid_request", details: reqErrors, statusCode: 400 };
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
      feeMode: feeModeNorm,
      speed: speedVal,
    };
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const paymasterContract = new ethers.Contract(paymaster, PAYMASTER_ABI, provider);
  const nowTs = Math.floor(Date.now() / 1000);
  const quoteRaw = await paymasterContract.quoteFeeUsd6(ownerEoa, 0, speedVal, nowTs);
  const baselineUsd6 = BigInt(quoteRaw[0]);
  const surchargeUsd6 = BigInt(quoteRaw[1]);
  const totalUsd6 = baselineUsd6 + surchargeUsd6;
  const decimals = Number(await paymasterContract.feeTokenDecimals(token));
  const price = BigInt(await paymasterContract.usd6PerWholeToken(token));
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
    netAmount,
    feeTokenMode: "same",
    feeMode: feeModeNorm,
    speed: speedVal,
  };
}
