import { useDisconnect } from "wagmi";
import { useWeb3Modal } from "@web3modal/wagmi/react";
import { useAppMode } from "../demo/AppModeContext";
import { useWalletState } from "../demo/useWalletState";

export default function WalletStatus() {
  const { isDemo } = useAppMode();
  const { address, isConnected } = useWalletState();
  const { disconnect } = useDisconnect();
  const { open } = useWeb3Modal();

  return (
    <div style={{ padding: 16, border: "1px solid #2a2a2a", borderRadius: 8 }}>
      {isDemo ? (
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div>Demo: connected {address}</div>
        </div>
      ) : isConnected ? (
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div>Connected: {address}</div>
          <button onClick={() => disconnect()}>Disconnect</button>
        </div>
      ) : (
        <button onClick={() => open()}>Connect</button>
      )}
    </div>
  );
}
