import { buildDeepLink, getWalletStoreUrl, isInWalletBrowser, isMobile, type WalletDeepLink } from "../utils/mobile";

type MobileConnectBannerProps = {
  isConnected: boolean;
  onMoreWallets: () => void;
  hasWalletConnect: boolean;
};

export default function MobileConnectBanner({ isConnected, onMoreWallets, hasWalletConnect }: MobileConnectBannerProps) {
  if (!isMobile() || isInWalletBrowser() || isConnected) return null;

  const openWallet = (wallet: WalletDeepLink) => {
    const currentUrl = window.location.href;
    const deepLink = buildDeepLink(currentUrl, wallet);
    const storeUrl = getWalletStoreUrl(wallet);
    if (!deepLink) return;
    window.location.href = deepLink;
    if (storeUrl) {
      setTimeout(() => {
        window.location.href = storeUrl;
      }, 1200);
    }
  };

  const handleMoreWallets = () => {
    if (!hasWalletConnect) {
      window.alert("WalletConnect is not configured. Set VITE_WALLETCONNECT_PROJECT_ID.");
      return;
    }
    onMoreWallets();
  };

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
        transform: "translateX(-50%)",
        width: "min(520px, calc(100% - 20px))",
        boxSizing: "border-box",
        zIndex: 40,
        boxShadow: "0 14px 30px rgba(0,0,0,0.45)",
        border: "1px solid #2a2a2a",
        borderRadius: 8,
        padding: 10,
        marginBottom: 0,
        background: "#141414",
      }}
    >
      <div style={{ fontSize: 12, color: "#bdbdbd", marginBottom: 8 }}>
        On mobile? Open in your wallet browser for the smoothest experience.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => openWallet("metamask")}>Open in MetaMask</button>
        <button onClick={() => openWallet("coinbase")}>Open in Coinbase Wallet</button>
        <button onClick={handleMoreWallets}>More wallets</button>
      </div>
    </div>
  );
}