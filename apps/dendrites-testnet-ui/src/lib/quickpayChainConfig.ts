export type QuickPayChainConfig = {
  router: string;
  permit2?: string;
  usdc?: string;
  entryPoint?: string;
  feeVault?: string;
};

const QUICKPAY_CHAIN_CONFIG: Record<number, QuickPayChainConfig> = {
  84532: {
    router: "0x0D65e8e31dc33F6cf4A176a5B0e3ed4044c561EB",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    feeVault: "0x7170296688737f3A26b9F86d24d366DA778E724c",
    entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  },
};

export function getQuickPayChainConfig(chainId?: number | null) {
  if (!chainId) return undefined;
  return QUICKPAY_CHAIN_CONFIG[chainId];
}
