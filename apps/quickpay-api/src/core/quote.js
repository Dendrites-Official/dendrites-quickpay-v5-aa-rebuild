import { ethers } from "ethers";

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
      return String(feeMode ?? "eco").toLowerCase() === "instant" ? 0 : 1;
    }
    if (trimmed === "eco") return 1;
    if (trimmed === "instant") return 0;
    return Number(trimmed);
  }
  return String(feeMode ?? "eco").toLowerCase() === "instant" ? 0 : 1;
}

export async function getQuote({
  rpcUrl,
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
}) {
  const modeNorm = String(mode ?? "").toUpperCase();
  const isSelfPay = modeNorm === "SELF_PAY";
  const feeModeNorm = String(feeMode ?? "eco").toLowerCase();
  const amountStr = typeof amount === "string" || typeof amount === "number" ? String(amount) : "";
  const speedVal = parseSpeed({ feeMode: feeModeNorm, speed });
  const envErrors = {};
  const reqErrors = {};

  const provider = rpcUrl ? new ethers.JsonRpcProvider(rpcUrl) : null;
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
  if (!/^(eco|instant)$/i.test(String(feeMode ?? ""))) {
    return { ok: false, error: "invalid_request", details: { feeMode: "expected_eco_or_instant" }, statusCode: 400 };
  }

  // speed tier (optional)
  if (speed != null && speed !== "") {
    const speedStr = String(speed).toLowerCase();
    if (!(["0", "1", "eco", "instant"].includes(speedStr))) {
      return { ok: false, error: "invalid_request", details: { speed: "expected_0_1_eco_or_instant" }, statusCode: 400 };
    }
  }

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

  if (provider && factoryAddress && ethers.isAddress(factoryAddress) && ownerEoa && ethers.isAddress(ownerEoa)) {
    const factoryAddr = ethers.getAddress(factoryAddress);
    const ownerAddr = ethers.getAddress(ownerEoa);
    const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, provider);
    smartSender = await factory["getAddress(address,uint256)"](ownerAddr, 0n);
    const code = await provider.getCode(smartSender);
    smartDeployed = typeof code === "string" && code !== "0x";
  }

  if (provider && token && ethers.isAddress(token)) {
    const tokenAddr = ethers.getAddress(token);
    const tokenContract = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
    if (permit2 && ethers.isAddress(permit2) && ownerEoa && ethers.isAddress(ownerEoa)) {
      const allowance = await tokenContract.allowance(ethers.getAddress(ownerEoa), ethers.getAddress(permit2));
      if (allowance === 0n) setupNeeded.push("permit2_allowance_missing");
    }
    if (smartDeployed && smartSender && router && ethers.isAddress(router)) {
      const allowance = await tokenContract.allowance(smartSender, ethers.getAddress(router));
      if (allowance === 0n) setupNeeded.push("aa_allowance_missing");
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
      feeMode: feeModeNorm,
      speed: speedVal,
      smartSender,
      smartDeployed,
      firstTxSurchargePaid: true,
      setupNeeded,
      router,
      permit2,
    };
  }

  const paymasterContract = new ethers.Contract(ethers.getAddress(paymaster), PAYMASTER_ABI, provider);
  const nowTs = Math.floor(Date.now() / 1000);
  const quoteRaw = await paymasterContract.quoteFeeUsd6(ownerEoa, 0, speedVal, nowTs);
  const baselineUsd6 = BigInt(quoteRaw[2]);
  const firstTxSurchargeUsd6 = BigInt(quoteRaw[3]);
  const capBps = BigInt(quoteRaw[4]);
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

  console.log(`QUOTE_INVARIANTS feeUsd6=${feeUsd6Final} maxFeeUsd6=${maxFeeUsd6Used}`);
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
    maxFeeUsd6: maxFeeUsd6Used.toString(),
    baselineUsd6: baselineUsd6.toString(),
    surchargeUsd6: surchargeUsd6.toString(),
    capBps: capBps.toString(),
    firstTxSurchargeApplies,
    netAmount,
    feeTokenMode: "same",
    feeMode: feeModeNorm,
    speed: speedVal,
    smartSender,
    smartDeployed,
    firstTxSurchargePaid: !firstTxSurchargeApplies,
    setupNeeded,
    router,
    permit2,
  };
}
