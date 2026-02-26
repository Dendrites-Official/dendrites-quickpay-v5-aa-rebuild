import { ethers } from "ethers";

export type GasEstimateResult = {
  gasLimit: bigint | null;
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
  costEth: string | null;
  error: string | null;
};

export type ReplacementFeeInput = {
  maxFeePerGas?: bigint | null;
  maxPriorityFeePerGas?: bigint | null;
  gasPrice?: bigint | null;
};

export type ReplacementFeeResult =
  | {
      mode: "eip1559";
      maxFeePerGas: bigint;
      maxPriorityFeePerGas: bigint;
      baseFeePerGas: bigint;
    }
  | {
      mode: "legacy";
      gasPrice: bigint;
    };

const MIN_PRIORITY_FEE = ethers.parseUnits("1.5", "gwei");
const BUMP_NUM = 1125n;
const BUMP_DEN = 1000n;

function applyMultiplier(value: bigint, multiplier: number) {
  const scale = 100;
  const scaled = BigInt(Math.round(multiplier * scale));
  return (value * scaled) / BigInt(scale);
}

function bumpValue(value: bigint) {
  return (value * BUMP_NUM) / BUMP_DEN;
}

export async function buildEip1559Fees(
  provider: ethers.AbstractProvider,
  multiplier: number,
  previous?: ReplacementFeeInput
): Promise<ReplacementFeeResult> {
  const feeData = await provider.getFeeData();
  const block = await provider.getBlock("latest");
  const baseFeePerGas = block?.baseFeePerGas ?? null;

  if (baseFeePerGas) {
    let priority = feeData.maxPriorityFeePerGas ?? MIN_PRIORITY_FEE;
    if (priority < MIN_PRIORITY_FEE) priority = MIN_PRIORITY_FEE;
    let maxFee = baseFeePerGas * 2n + priority;

    let nextPriority = applyMultiplier(priority, multiplier);
    let nextMaxFee = applyMultiplier(maxFee, multiplier);

    if (previous?.maxPriorityFeePerGas) {
      nextPriority = nextPriority > bumpValue(previous.maxPriorityFeePerGas)
        ? nextPriority
        : bumpValue(previous.maxPriorityFeePerGas);
    }
    if (previous?.maxFeePerGas) {
      nextMaxFee = nextMaxFee > bumpValue(previous.maxFeePerGas)
        ? nextMaxFee
        : bumpValue(previous.maxFeePerGas);
    }

    const minRequired = baseFeePerGas * 2n + nextPriority;
    if (nextMaxFee < minRequired) {
      nextMaxFee = minRequired;
    }

    return {
      mode: "eip1559",
      maxFeePerGas: nextMaxFee,
      maxPriorityFeePerGas: nextPriority,
      baseFeePerGas,
    };
  }

  const gasPrice = feeData.gasPrice ?? MIN_PRIORITY_FEE;
  let nextGasPrice = applyMultiplier(gasPrice, multiplier);
  if (previous?.gasPrice) {
    const bumped = bumpValue(previous.gasPrice);
    if (nextGasPrice < bumped) nextGasPrice = bumped;
  }
  return { mode: "legacy", gasPrice: nextGasPrice };
}

export async function estimateTxCost(
  provider: ethers.BrowserProvider,
  txRequest: ethers.TransactionRequest
): Promise<GasEstimateResult> {
  try {
    const [gasLimit, feeData] = await Promise.all([
      provider.estimateGas(txRequest),
      provider.getFeeData(),
    ]);
    const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? null;
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? null;
    const cost = maxFeePerGas ? gasLimit * maxFeePerGas : null;
    const costEth = cost ? `${ethers.formatEther(cost)} ETH` : null;
    return {
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      costEth,
      error: null,
    };
  } catch (err: any) {
    return {
      gasLimit: null,
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
      costEth: null,
      error: err?.message || "estimate_failed",
    };
  }
}
