import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { DEMO_MODE_STORAGE_KEY } from "./demoData";

type AppModeContextValue = {
  isDemo: boolean;
  setDemo: (next: boolean) => void;
  toggleDemo: () => void;
};

const AppModeContext = createContext<AppModeContextValue | null>(null);

function readStoredDemo() {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DEMO_MODE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppModeProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [isDemo, setIsDemo] = useState(readStoredDemo);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const demoParam = params.get("demo");
    if (demoParam === "1" || demoParam === "true") {
      setIsDemo(true);
    } else if (demoParam === "0" || demoParam === "false") {
      setIsDemo(false);
    }
  }, [location.search]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(DEMO_MODE_STORAGE_KEY, isDemo ? "1" : "0");
    } catch {
      // ignore storage failures
    }
  }, [isDemo]);

  const setDemo = useCallback((next: boolean) => setIsDemo(Boolean(next)), []);
  const toggleDemo = useCallback(() => setIsDemo((prev) => !prev), []);

  const value = useMemo(() => ({ isDemo, setDemo, toggleDemo }), [isDemo, setDemo, toggleDemo]);

  return <AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>;
}

export function useAppMode() {
  const ctx = useContext(AppModeContext);
  if (!ctx) {
    throw new Error("useAppMode must be used within AppModeProvider");
  }
  return ctx;
}
