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
  if (typeof speed === "string" && speed !== "") return Number(speed);
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
  const isSelfPay = mode === "SELF_PAY";
  if (isSelfPay) {
    return {
      ok: true,
      sponsored: false,
      lane: "SELF_PAY",
      feeUsd6: "0",
      feeTokenAmount: "0",
      netAmount: String(amount),
      feeTokenMode: "same",
      feeMode: feeMode ?? "eco",
      speed: parseSpeed({ feeMode, speed }),
    };
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const paymasterContract = new ethers.Contract(paymaster, PAYMASTER_ABI, provider);
  const nowTs = Math.floor(Date.now() / 1000);
  const speedVal = parseSpeed({ feeMode, speed });
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
    feeMode: feeMode ?? "eco",
    speed: speedVal,
  };
}
