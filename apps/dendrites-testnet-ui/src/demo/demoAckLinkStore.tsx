import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type DemoAckLink = {
  id: string;
  url: string;
  code: string;
  amountUsdc6: string;
  feeUsdc6: string;
  token: string;
  tokenSymbol: string;
  tokenDecimals: number;
  chainId: number;
  createdAt: string;
  status: "created" | "claimed" | "refunded" | "expired";
  sender: string;
  senderName?: string | null;
  message?: string | null;
  reason?: string | null;
  note?: string | null;
  claimedTo?: string | null;
};

type DemoAckLinkContextValue = {
  links: Map<string, DemoAckLink>;
  addLink: (link: DemoAckLink) => void;
  updateLink: (id: string, patch: Partial<DemoAckLink>) => void;
  getLink: (id: string) => DemoAckLink | null;
  clearLinks: () => void;
};

const DemoAckLinkContext = createContext<DemoAckLinkContextValue | null>(null);

const DEMO_ACKLINK_STORAGE_KEY = "DENDRITES_DEMO_ACKLINKS";

const readStoredLinks = () => {
  if (typeof window === "undefined") return new Map<string, DemoAckLink>();
  try {
    const raw = window.localStorage.getItem(DEMO_ACKLINK_STORAGE_KEY);
    if (!raw) return new Map<string, DemoAckLink>();
    const parsed = JSON.parse(raw) as DemoAckLink[];
    const map = new Map<string, DemoAckLink>();
    for (const link of parsed || []) {
      if (link?.id) map.set(link.id, link);
    }
    return map;
  } catch {
    return new Map<string, DemoAckLink>();
  }
};

const persistLinks = (links: Map<string, DemoAckLink>) => {
  if (typeof window === "undefined") return;
  try {
    const payload = Array.from(links.values());
    window.localStorage.setItem(DEMO_ACKLINK_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
};

export function DemoAckLinkProvider({ children }: { children: React.ReactNode }) {
  const [links, setLinks] = useState<Map<string, DemoAckLink>>(readStoredLinks);

  const addLink = useCallback((link: DemoAckLink) => {
    setLinks((prev) => {
      const next = new Map(prev);
      next.set(link.id, link);
      persistLinks(next);
      return next;
    });
  }, []);

  const updateLink = useCallback((id: string, patch: Partial<DemoAckLink>) => {
    setLinks((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      const current = next.get(id);
      if (!current) return prev;
      next.set(id, { ...current, ...patch });
      persistLinks(next);
      return next;
    });
  }, []);

  const getLink = useCallback(
    (id: string) => {
      return links.get(id) ?? null;
    },
    [links]
  );

  const clearLinks = useCallback(() => {
    setLinks(new Map());
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(DEMO_ACKLINK_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo(
    () => ({ links, addLink, updateLink, getLink, clearLinks }),
    [addLink, clearLinks, getLink, links, updateLink]
  );

  return <DemoAckLinkContext.Provider value={value}>{children}</DemoAckLinkContext.Provider>;
}

export function useDemoAckLinkStore() {
  const ctx = useContext(DemoAckLinkContext);
  if (!ctx) {
    throw new Error("useDemoAckLinkStore must be used within DemoAckLinkProvider");
  }
  return ctx;
}
