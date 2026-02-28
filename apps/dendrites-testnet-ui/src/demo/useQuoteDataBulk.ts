import { useCallback } from "react";
import { qpUrl } from "../lib/quickpayApiBase";
import { useAppMode } from "./AppModeContext";
import { buildDemoBulkQuote } from "./demoData";

type BulkQuoteParams = {
  chainId: number;
  from: string | undefined;
  token: string;
  to: string;
  amountRaw: string;
  speedLabel: string;
  speed: 0 | 1;
};

export function useQuoteDataBulk() {
  const { isDemo } = useAppMode();

  const getQuote = useCallback(
    async (params: BulkQuoteParams) => {
      if (isDemo) {
        await new Promise((resolve) => setTimeout(resolve, 160));
        return buildDemoBulkQuote(BigInt(params.amountRaw));
      }

      const res = await fetch(qpUrl("/quoteBulk"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: params.chainId,
          from: params.from,
          token: params.token,
          to: params.to,
          amount: params.amountRaw,
          feeMode: params.speedLabel,
          speed: params.speed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503 && data?.code === "BULK_NOT_CONFIGURED") {
        throw new Error("Bulk is not enabled on the API yet. Set ROUTER_BULK/PAYMASTER_BULK in Railway.");
      }
      if (res.status === 400 || data?.ok === false) {
        const details = data?.details ? ` ${JSON.stringify(data.details)}` : "";
        throw new Error(`${data?.error || "Bad request"}${details}`.trim());
      }
      if (!res.ok) throw new Error(data?.error || "Failed to get quote");
      return data;
    },
    [isDemo]
  );

  return { getQuote };
}
