import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useConnect, useDisconnect, useChainId } from "wagmi";
import { useWeb3Modal } from "@web3modal/wagmi/react";
import { logDappConnection } from "../lib/dappConnections";
import { logAppEvent } from "../lib/appEvents";
import { buildDeepLink, getWalletStoreUrl, isInWalletBrowser, isMobile } from "../utils/mobile";

const WC_PROJECT_ID = String(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "").trim();

function useOptionalWeb3Modal() {
  try {
    return useWeb3Modal();
  } catch {
    return null;
  }
}

export default function WalletButton() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { connect, connectors, isPending } = useConnect();
  const web3Modal = useOptionalWeb3Modal();
  const [showMobileNote, setShowMobileNote] = useState(false);

  const shortAddress = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : "";

  useEffect(() => {
    if (!isConnected || !address) return;
    void logDappConnection(address);
    void logAppEvent("wallet_connect", {
      address,
      chainId,
    });
  }, [address, isConnected]);

  const handleConnect = () => {
    const injected = connectors.find((connector) => connector.type === "injected");
    const needsMobileNote = isMobile() && !isInWalletBrowser();
    if (needsMobileNote) {
      setShowMobileNote(true);
      return;
    }
    if (isInWalletBrowser() && injected) {
      connect({ connector: injected });
      return;
    }
    doConnect();
  };

  const openWallet = (wallet: "metamask" | "coinbase") => {
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

  const doConnect = () => {
    if (web3Modal?.open) {
      web3Modal.open();
      return;
    }
    if (!WC_PROJECT_ID && !connectors?.length) {
      window.alert("WalletConnect is not configured. Set VITE_WALLETCONNECT_PROJECT_ID.");
      return;
    }
    const injected = connectors.find((connector) => connector.type === "injected") ?? connectors[0];
    if (injected) {
      connect({ connector: injected });
    } else {
      console.warn("No wallet connectors available.");
    }
  };

  return isConnected ? (
    <div className="dx-walletConnected">
      <span className="dx-walletAddress">{shortAddress}</span>
      <button className="dx-walletDisconnect" onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  ) : (
    <div className="dx-walletWrapper">
      {showMobileNote && typeof document !== "undefined"
        ? createPortal(
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.6)",
                display: "grid",
                placeItems: "center",
                zIndex: 100000,
              }}
            >
              <div
                style={{
                  width: "min(520px, calc(100% - 24px))",
                  margin: "0 auto",
                  background: "#111",
                  border: "1px solid #2a2a2a",
                  borderRadius: 12,
                  padding: 14,
                  boxShadow: "0 18px 40px rgba(0,0,0,0.55)",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Best mobile UX</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginBottom: 12 }}>
                  For the smoothest experience, open this site in your wallet browser.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  <button type="button" onClick={() => openWallet("metamask")}>Open in MetaMask</button>
                  <button type="button" onClick={() => openWallet("coinbase")}>Open in Coinbase Wallet</button>
                  <button type="button" onClick={() => openWallet("coinbase")}>Open in Base Wallet</button>
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => setShowMobileNote(false)}
                    style={{ background: "transparent", color: "#bdbdbd", border: "1px solid #333" }}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowMobileNote(false);
                      doConnect();
                    }}
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {isPending ? (
        <button className="dx-walletConnect" disabled>
          Connecting…
        </button>
      ) : (
        <button className="dx-walletConnect" onClick={handleConnect}>
          Connect Wallet
        </button>
      )}
    </div>
  );
}
