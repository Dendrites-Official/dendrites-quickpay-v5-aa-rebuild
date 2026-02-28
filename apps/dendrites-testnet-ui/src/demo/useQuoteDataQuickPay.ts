import { useCallback } from "react";
import { qpUrl } from "../lib/quickpayApiBase";
import { useAppMode } from "./AppModeContext";
import { buildDemoQuickPayQuote } from "./demoData";

type QuickPayQuoteParams = {
  chainId: number;
  ownerEoa: string | undefined;
  token: string;
  to: string;
  amountRaw: string;
  speedLabel: string;
  speed: 0 | 1;
  mode: "SPONSORED" | "SELF_PAY";
  signal?: AbortSignal;
  decimals: number;
};

export function useQuoteDataQuickPay() {
  const { isDemo } = useAppMode();

  const getQuote = useCallback(
    async (params: QuickPayQuoteParams) => {
      if (isDemo) {
        await new Promise((resolve) => setTimeout(resolve, 180));
        return buildDemoQuickPayQuote({
          amountRaw: params.amountRaw,
          decimals: params.decimals,
          speedLabel: params.speedLabel,
          speed: params.speed,
          mode: params.mode,
        });
      }

      const body = {
        chainId: params.chainId,
        ownerEoa: params.ownerEoa,
        token: params.token,
        to: params.to,
        amount: params.amountRaw,
        feeMode: params.speedLabel,
        speed: params.speed,
        mode: params.mode,
      };

      const res = await fetch(qpUrl("/quote"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: params.signal,
      });
      const data = await res.json().catch(() => ({}));
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
