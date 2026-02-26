import { supabase } from "./supabaseClient";

const SESSION_KEY = "dx_session_id";
const LOG_PREFIX = "dx_connect_logged";
const GEO_URL = "https://ipapi.co/json";

type GeoInfo = {
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
};

function getSessionId() {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem(SESSION_KEY, id);
  return id;
}

async function fetchGeo(): Promise<GeoInfo | null> {
  try {
    const res = await fetch(GEO_URL, { method: "GET" });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return {
      country: typeof data.country_code === "string" ? data.country_code : null,
      region: typeof data.region === "string" ? data.region : null,
      city: typeof data.city === "string" ? data.city : null,
      lat: typeof data.latitude === "number" ? data.latitude : null,
      lon: typeof data.longitude === "number" ? data.longitude : null,
    };
  } catch {
    return null;
  }
}

export async function logDappConnection(wallet: string) {
  if (!wallet || typeof window === "undefined") return;

  const sessionId = getSessionId();
  if (!sessionId) return;

  const normalized = wallet.trim().toLowerCase();
  const dedupeKey = `${LOG_PREFIX}:${sessionId}:${normalized}`;
  if (window.sessionStorage.getItem(dedupeKey)) return;
  window.sessionStorage.setItem(dedupeKey, "1");

  const geo = await fetchGeo();

  await supabase.from("dapp_connections").insert({
    wallet: normalized,
    session_id: sessionId,
    user_agent: navigator.userAgent,
    geo_country: geo?.country ?? null,
    geo_region: geo?.region ?? null,
    geo_city: geo?.city ?? null,
    geo_lat: geo?.lat ?? null,
    geo_lon: geo?.lon ?? null,
  });
}
