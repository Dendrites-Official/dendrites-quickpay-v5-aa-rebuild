import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useWeb3Modal } from "@web3modal/wagmi/react";

function useOptionalWeb3Modal() {
  try {
    return useWeb3Modal();
  } catch {
    return null;
  }
}

export default function WalletButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { connect, connectors, isPending } = useConnect();
  const web3Modal = useOptionalWeb3Modal();

  const shortAddress = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : "";

  const handleConnect = () => {
    if (web3Modal?.open) {
      web3Modal.open();
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
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <span>{shortAddress}</span>
      <button onClick={() => disconnect()}>Disconnect</button>
    </div>
  ) : (
    <button onClick={handleConnect} disabled={isPending}>
      {isPending ? "Connecting…" : "Connect"}
    </button>
  );
}
