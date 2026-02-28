import { useCallback, useMemo } from "react";
import { listReceipts as listReceiptsReal } from "../lib/receiptsApi";
import { quickpayReceipt as quickpayReceiptReal } from "../lib/api";
import { useAppMode } from "./AppModeContext";
import { demoReceipts } from "./demoData";
import { useDemoReceiptsStore } from "./DemoReceiptsStore";

type ListParams = {
  limit?: number;
  wallet?: string;
};

type LookupParams = {
  receiptId?: string;
  userOpHash?: string;
  txHash?: string;
  chainId?: number;
};

export function useReceiptsData() {
  const { isDemo } = useAppMode();
  const { receipts } = useDemoReceiptsStore();

  const mergedReceipts = useMemo(() => {
    if (!isDemo) return [];
    return [...receipts, ...demoReceipts];
  }, [isDemo, receipts]);

  const listReceipts = useCallback(
    async ({ limit = 50, wallet }: ListParams) => {
      if (!isDemo) {
        return listReceiptsReal({ limit, wallet });
      }
      const lower = wallet ? wallet.toLowerCase() : "";
      const filtered = lower
        ? mergedReceipts.filter((item) => String(item.owner_eoa ?? "").toLowerCase() === lower)
        : mergedReceipts;
      return filtered.slice(0, limit);
    },
    [isDemo, mergedReceipts]
  );

  const lookupReceipt = useCallback(
    async (payload: LookupParams) => {
      if (!isDemo) {
        return quickpayReceiptReal(payload);
      }
      const receiptId = String(payload.receiptId ?? "").trim();
      const userOpHash = String(payload.userOpHash ?? "").trim().toLowerCase();
      const txHash = String(payload.txHash ?? "").trim().toLowerCase();
      return (
        mergedReceipts.find((item) =>
          (receiptId && String(item.receipt_id ?? "") === receiptId) ||
          (userOpHash && String(item.userop_hash ?? "").toLowerCase() === userOpHash) ||
          (txHash && String(item.tx_hash ?? "").toLowerCase() === txHash)
        ) ?? null
      );
    },
    [isDemo, mergedReceipts]
  );

  return {
    isDemo,
    mergedReceipts,
    listReceipts,
    lookupReceipt,
  };
}
