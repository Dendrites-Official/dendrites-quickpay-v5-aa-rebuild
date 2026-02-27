import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { buildDeepLink, getWalletStoreUrl, isInWalletBrowser, isMobile, type WalletDeepLink } from "../utils/mobile";

type MobileConnectBannerProps = {
  isConnected: boolean;
  onMoreWallets: () => void;
  hasWalletConnect: boolean;
};

export default function MobileConnectBanner({ isConnected, onMoreWallets, hasWalletConnect }: MobileConnectBannerProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const checkModal = () => {
      const hasModal = Boolean(
        document.querySelector(
          "w3m-modal,w3m-modal-container,w3m-modal-card,[data-testid='w3m-modal'],[role='dialog']"
        )
      );
      setModalOpen(hasModal);
    };
    checkModal();
    const observer = new MutationObserver(checkModal);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!isMobile() || isInWalletBrowser() || isConnected || modalOpen || dismissed) return null;

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

  const content = (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
        transform: "translateX(-50%)",
        width: "min(520px, calc(100% - 20px))",
        boxSizing: "border-box",
        zIndex: 20,
        boxShadow: "0 14px 30px rgba(0,0,0,0.45)",
        border: "1px solid #2a2a2a",
        borderRadius: 8,
        padding: 10,
        marginBottom: 0,
        background: "#141414",
      }}
    >
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          position: "absolute",
          top: 6,
          right: 8,
          background: "transparent",
          border: "none",
          color: "rgba(255,255,255,0.6)",
          fontSize: 16,
          cursor: "pointer",
        }}
      >
        ×
      </button>
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

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}