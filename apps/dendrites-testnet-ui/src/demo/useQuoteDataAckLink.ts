import { useCallback } from "react";
import { acklinkQuote } from "../lib/api";
import { useAppMode } from "./AppModeContext";
import { demoAckLinkQuote } from "./demoData";

type AckLinkQuoteParams = {
  from: string;
  amountUsdc6: string;
  speed: "eco" | "instant";
};

export function useQuoteDataAckLink() {
  const { isDemo } = useAppMode();

  const getQuote = useCallback(
    async (params: AckLinkQuoteParams) => {
      if (isDemo) {
        await new Promise((resolve) => setTimeout(resolve, 160));
        return {
          ...demoAckLinkQuote,
          speed: params.speed,
        };
      }
      return acklinkQuote(params);
    },
    [isDemo]
  );

  return { getQuote };
}
