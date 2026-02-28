import { useAccount, useChainId } from "wagmi";
import { DEMO_ADDRESS, DEMO_CHAIN_ID, DEMO_CHAIN_NAME } from "./demoData";
import { useAppMode } from "./AppModeContext";

export function useWalletState() {
  const { isDemo } = useAppMode();
  const account = useAccount();
  const chainId = useChainId();

  if (!isDemo) {
    return {
      address: account.address,
      isConnected: account.isConnected,
      chainId,
      chainName: chainId ? `Chain ${chainId}` : "",
    };
  }

  return {
    address: DEMO_ADDRESS,
    isConnected: true,
    chainId: DEMO_CHAIN_ID,
    chainName: DEMO_CHAIN_NAME,
  };
}
