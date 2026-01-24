const DEFAULT_QP_API = "https://dendrites-quickpay-v5-aa-rebuild-production.up.railway.app";

export const QUICKPAY_API_BASE = (import.meta.env.VITE_QUICKPAY_API_URL || DEFAULT_QP_API)
  .trim()
  .replace(/\/+$/, ""); // remove trailing slashes

export function qpUrl(path: string) {
  return new URL(path, QUICKPAY_API_BASE).toString();
}
