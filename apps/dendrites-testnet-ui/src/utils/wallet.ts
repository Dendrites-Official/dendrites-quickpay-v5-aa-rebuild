type AddTokenParams = {
  address: string;
  symbol: string;
  decimals: number;
  image?: string;
};

export async function addTokenToWallet({ address, symbol, decimals, image }: AddTokenParams) {
  const ethereum = (window as any)?.ethereum;
  if (!ethereum?.request) {
    throw new Error("MetaMask not detected. Install MetaMask to add tokens.");
  }

  const result = await ethereum.request({
    method: "wallet_watchAsset",
    params: {
      type: "ERC20",
      options: {
        address,
        symbol,
        decimals,
        ...(image ? { image } : {}),
      },
    },
  });

  return Boolean(result);
}
