import { qpUrl } from "./quickpayApiBase";

export type AppEventMeta = Record<string, unknown> | undefined;

export async function logEvent(kind: string, meta?: AppEventMeta, address?: string | null, chainId?: number | null) {
  try {
    await fetch(qpUrl("/events/log"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        meta: meta ?? undefined,
        address: address ?? undefined,
        chainId: chainId ?? undefined,
      }),
    });
  } catch {
    // ignore logging failures
  }
}
