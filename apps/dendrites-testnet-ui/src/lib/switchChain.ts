type Eip1193Provider = {
  request: (args: { method: string; params?: any[] }) => Promise<any>;
  rpcUrl?: string;
  rpcUrls?: { default?: { http?: string[] } } | string[];
};

function getRpcUrls(provider: Eip1193Provider | null | undefined, fallback: string) {
  const urls: string[] = [];
  const candidate = (provider as any)?.rpcUrl || (provider as any)?.rpcUrls?.default?.http?.[0] || (provider as any)?.rpcUrls?.[0];
  if (candidate) urls.push(String(candidate));
  if (fallback) urls.push(fallback);
  return Array.from(new Set(urls.filter(Boolean)));
}

async function switchChain(provider: Eip1193Provider, params: {
  chainId: string;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}) {
  if (!provider?.request) {
    throw new Error("Wallet provider not available.");
  }

  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: params.chainId }] });
    return;
  } catch (err: any) {
    const code = err?.code ?? err?.data?.code;
    if (code === 4902) {
      await provider.request({ method: "wallet_addEthereumChain", params: [params] });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: params.chainId }] });
      return;
    }
    throw err;
  }
}

export async function switchToBase(provider: Eip1193Provider) {
  const rpcUrls = getRpcUrls(provider, "https://mainnet.base.org");
  return switchChain(provider, {
    chainId: "0x2105",
    chainName: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls,
    blockExplorerUrls: ["https://base.blockscout.com"],
  });
}

export async function switchToBaseSepolia(provider: Eip1193Provider) {
  const rpcUrls = getRpcUrls(provider, "https://sepolia.base.org");
  return switchChain(provider, {
    chainId: "0x14a34",
    chainName: "Base Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls,
    blockExplorerUrls: ["https://base-sepolia.blockscout.com"],
  });
}
