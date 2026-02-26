import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type IncomingEvent = {
  kind?: string;
  address?: string | null;
  chainId?: number | string | null;
  meta?: Record<string, unknown> | null;
};

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getClientIp(req: Request) {
  const direct = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
  if (direct) return direct.trim();
  const forwarded = req.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0]?.trim() || "";
}

function jsonResponse(origin: string | undefined, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin),
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? undefined;

  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse(origin, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
  }

  let payload: IncomingEvent = {};
  try {
    payload = (await req.json()) as IncomingEvent;
  } catch {
    return jsonResponse(origin, 400, { ok: false, code: "INVALID_JSON" });
  }

  const kind = String(payload.kind ?? "").trim();
  if (!kind) return jsonResponse(origin, 400, { ok: false, code: "MISSING_KIND" });

  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceRoleKey = String(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? ""
  ).trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(origin, 500, { ok: false, code: "SUPABASE_ENV_MISSING" });
  }

  const salt = String(Deno.env.get("EVENT_HASH_SALT") ?? "");
  const ip = getClientIp(req);
  const ua = req.headers.get("user-agent") || "";

  const ipHash = ip && salt ? await sha256Hex(`${salt}:${ip}`) : null;
  const uaHash = ua && salt ? await sha256Hex(`${salt}:${ua}`) : null;

  const record = {
    kind,
    address: payload.address ? String(payload.address).toLowerCase() : null,
    chain_id: payload.chainId != null ? Number(payload.chainId) : null,
    meta: payload.meta && typeof payload.meta === "object" ? payload.meta : {},
    ip_hash: ipHash,
    ua_hash: uaHash,
  };

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { error } = await supabase.from("app_events").insert(record);
  if (error) {
    return jsonResponse(origin, 500, { ok: false, code: "INSERT_FAILED" });
  }

  return jsonResponse(origin, 200, { ok: true });
});
