const DEFAULT_QP_API = "https://dendrites-quickpay-v5-aa-rebuild-production.up.railway.app";
const RAW_QP_API = String(import.meta.env.VITE_QUICKPAY_API_URL || "").trim();
const FALLBACK_QP_API = RAW_QP_API || DEFAULT_QP_API;
const isLocalHost =
  typeof window !== "undefined" &&
  /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
const safeApiBase = !isLocalHost && /localhost|127\.0\.0\.1/i.test(FALLBACK_QP_API)
  ? DEFAULT_QP_API
  : FALLBACK_QP_API;

export const QUICKPAY_API_BASE = safeApiBase.replace(/\/+$/, ""); // remove trailing slashes

export function qpUrl(path: string) {
  return new URL(path, QUICKPAY_API_BASE).toString();
}
