import { ethers } from "ethers";

export type GasEstimateResult = {
  gasLimit: bigint | null;
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
  costEth: string | null;
  error: string | null;
};

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
