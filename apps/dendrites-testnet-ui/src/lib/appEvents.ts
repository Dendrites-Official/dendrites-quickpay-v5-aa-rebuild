const SUPABASE_FUNCTIONS_BASE = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");

function getFunctionsUrl(path: string) {
  if (!SUPABASE_FUNCTIONS_BASE) return null;
  return `${SUPABASE_FUNCTIONS_BASE}/functions/v1/${path}`;
}

type AppEventPayload = {
  address?: string | null;
  chainId?: number | string | null;
  meta?: Record<string, unknown> | null;
};

export async function logAppEvent(kind: string, payload: AppEventPayload = {}) {
  const url = getFunctionsUrl("app_events_ingest");
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        address: payload.address ?? null,
        chainId: payload.chainId ?? null,
        meta: payload.meta ?? {},
      }),
    });
  } catch {
    // ignore telemetry failures
  }
}
