export type WalletDeepLink = "metamask" | "coinbase";

export function isMobile() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobi/i.test(ua);
}

export function isInWalletBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = (navigator.userAgent || "").toLowerCase();
  return (
    ua.includes("metamask") ||
    ua.includes("coinbasewallet") ||
    ua.includes("cbwallet") ||
    ua.includes("trust") ||
    ua.includes("rainbow") ||
    ua.includes("tokenpocket")
  );
}

export function buildDeepLink(url: string, wallet: WalletDeepLink) {
  if (!url) return "";
  if (wallet === "metamask") {
    try {
      const parsed = new URL(url);
      const pathWithQuery = `${parsed.host}${parsed.pathname}${parsed.search}`;
      return `metamask://dapp/${pathWithQuery}`;
    } catch {
      return `metamask://dapp/${url}`;
    }
  }
  return `cbwallet://dapp?url=${encodeURIComponent(url)}`;
}

export function getWalletStoreUrl(wallet: WalletDeepLink) {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  if (wallet === "metamask") {
    return isIOS
      ? "https://apps.apple.com/app/metamask/id1438144202"
      : "https://play.google.com/store/apps/details?id=io.metamask";
  }
  return isIOS
    ? "https://apps.apple.com/app/coinbase-wallet/id1278383455"
    : "https://play.google.com/store/apps/details?id=org.toshi";
}