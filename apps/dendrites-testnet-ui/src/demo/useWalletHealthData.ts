import { useMemo } from "react";
import { useAppMode } from "./AppModeContext";
import { demoWalletHealth } from "./demoData";

export function useWalletHealthData() {
  const { isDemo } = useAppMode();
  const demoData = useMemo(() => demoWalletHealth, []);

  return {
    isDemo,
    demoData,
  };
}
