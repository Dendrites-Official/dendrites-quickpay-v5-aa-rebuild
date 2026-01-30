import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const REDACT_KEYS = ["auth", "authorization", "password", "secret", "key", "token"];

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const lower = key.toLowerCase();
      output[key] = REDACT_KEYS.some((needle) => lower.includes(needle)) ? "[REDACTED]" : redact(val);
    }
    return output;
  }
  return value;
}

function logInfo(reqId: string, message: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level: "info", reqId, message, ...redact(data) }));
}

function logError(reqId: string, message: string, data: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ level: "error", reqId, message, ...redact(data) }));
}

function jsonResponse(origin: string | undefined, status: number, body: unknown, reqId?: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), ...(reqId ? { "x-request-id": reqId } : {}) },
  });
}

async function isSupabaseAuthed(req: Request): Promise<boolean> {
  const authHeader = String(req.headers.get("authorization") ?? "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;

  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") ?? "").trim();
  const supabaseAnon = String(Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
  if (!supabaseUrl || !supabaseAnon) return false;

  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error) return false;
  return Boolean(data?.user?.id);
}

async function requireAdminAuth(req: Request, reqId: string) {
  const required = String(Deno.env.get("ADMIN_UI_KEY") ?? "").trim();
  const provided = String(req.headers.get("x-admin-ui-key") ?? "").trim();
  if (!required) {
    logError(reqId, "ADMIN_UI_KEY_MISSING");
    return { ok: false, status: 500, body: { ok: false, reqId, code: "ADMIN_UI_KEY_MISSING" } };
  }
  if (provided && provided === required) return null;

  const authed = await isSupabaseAuthed(req);
  if (authed) return null;

  return { ok: false, status: 401, body: { ok: false, reqId, code: "UNAUTHORIZED" } };
}

function getRailwayAuth(reqId: string) {
  const user = String(Deno.env.get("RAILWAY_ADMIN_USER") ?? "").trim();
  const pass = String(Deno.env.get("RAILWAY_ADMIN_PASS") ?? "").trim();
  if (!user || !pass) {
    logError(reqId, "RAILWAY_AUTH_MISSING");
    return null;
  }
  return btoa(`${user}:${pass}`);
}

Deno.serve(async (req) => {
  const reqId = crypto.randomUUID();
  const origin = req.headers.get("origin") ?? undefined;

  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse(origin, 405, { ok: false, reqId, code: "METHOD_NOT_ALLOWED" }, reqId);
  }

  const authCheck = await requireAdminAuth(req, reqId);
  if (authCheck) return jsonResponse(origin, authCheck.status, authCheck.body, reqId);

  const railwayAuth = getRailwayAuth(reqId);
  if (!railwayAuth) {
    return jsonResponse(origin, 500, { ok: false, reqId, code: "RAILWAY_AUTH_MISSING" }, reqId);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    logInfo(reqId, "snapshot_proxy_start");
    const res = await fetch(
      "https://dendrites-quickpay-v5-aa-rebuild-production.up.railway.app/admin/snapshot/run",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${railwayAuth}`,
          "content-type": "application/json",
        },
        body: "{}",
        signal: controller.signal,
      }
    );

    const text = await res.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    logInfo(reqId, "snapshot_proxy_done", { status: res.status });
    return jsonResponse(origin, res.status, payload, reqId);
  } catch (err) {
    logError(reqId, "snapshot_proxy_error", { error: (err as Error)?.message || String(err) });
    return jsonResponse(origin, 502, { ok: false, reqId, code: "UPSTREAM_ERROR" }, reqId);
  } finally {
    clearTimeout(timeout);
  }
});
