import { useEffect } from "react";
import { useAccount, useConnect, useDisconnect, useChainId } from "wagmi";
import { useWeb3Modal } from "@web3modal/wagmi/react";
import MobileConnectBanner from "./MobileConnectBanner";
import { logDappConnection } from "../lib/dappConnections";
import { logAppEvent } from "../lib/appEvents";

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
      <MobileConnectBanner
        isConnected={isConnected}
        onMoreWallets={handleConnect}
        hasWalletConnect={Boolean(WC_PROJECT_ID)}
      />
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
