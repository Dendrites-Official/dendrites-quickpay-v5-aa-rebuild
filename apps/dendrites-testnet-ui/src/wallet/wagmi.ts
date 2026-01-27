import { http, createConfig } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { defineChain } from "viem";
import { createWeb3Modal } from "@web3modal/wagmi/react";

export const appName = "Dendrites Testnet UI";

export const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://sepolia.base.org"] },
  },
  blockExplorers: {
    default: { name: "BaseScan", url: "https://sepolia.basescan.org" },
  },
});

const wcProjectId = String(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "").trim();

const connectors = [
  injected(),
  ...(wcProjectId ? [walletConnect({ projectId: wcProjectId, showQrModal: true })] : []),
];

export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  transports: {
    [baseSepolia.id]: http(),
  },
  connectors,
});

if (wcProjectId) {
  try {
    createWeb3Modal({
      wagmiConfig,
      projectId: wcProjectId,
      metadata: {
        name: appName,
        description: "Dendrites QuickPay Testnet",
        url: "http://localhost:5173",
        icons: ["https://avatars.githubusercontent.com/u/38020230"],
      },
    });
  } catch (err) {
    console.warn("Web3Modal init failed", err);
  }
}
