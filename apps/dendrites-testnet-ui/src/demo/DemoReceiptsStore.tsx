import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { DemoReceipt } from "./demoData";

type DemoReceiptsContextValue = {
  receipts: DemoReceipt[];
  addReceipt: (receipt: DemoReceipt) => void;
  clearReceipts: () => void;
};

const DemoReceiptsContext = createContext<DemoReceiptsContextValue | null>(null);

export function DemoReceiptsProvider({ children }: { children: React.ReactNode }) {
  const [receipts, setReceipts] = useState<DemoReceipt[]>([]);

  const addReceipt = useCallback((receipt: DemoReceipt) => {
    setReceipts((prev) => [receipt, ...prev]);
  }, []);

  const clearReceipts = useCallback(() => setReceipts([]), []);

  const value = useMemo(
    () => ({ receipts, addReceipt, clearReceipts }),
    [addReceipt, clearReceipts, receipts]
  );

  return <DemoReceiptsContext.Provider value={value}>{children}</DemoReceiptsContext.Provider>;
}

export function useDemoReceiptsStore() {
  const ctx = useContext(DemoReceiptsContext);
  if (!ctx) {
    throw new Error("useDemoReceiptsStore must be used within DemoReceiptsProvider");
  }
  return ctx;
}
