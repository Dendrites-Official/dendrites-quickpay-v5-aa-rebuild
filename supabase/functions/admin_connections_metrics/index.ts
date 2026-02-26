import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    return { ok: false, status: 500, body: { ok: false, reqId, code: "ADMIN_UI_KEY_MISSING" } };
  }
  if (provided && provided === required) return null;

  const authed = await isSupabaseAuthed(req);
  if (authed) return null;

  return { ok: false, status: 401, body: { ok: false, reqId, code: "UNAUTHORIZED" } };
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

  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceRoleKey = String(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? ""
  ).trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(origin, 500, { ok: false, reqId, code: "SUPABASE_ENV_MISSING" }, reqId);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const connections24Res = await supabase
      .from("dapp_connections")
      .select("id", { count: "exact", head: true })
      .gte("connected_at", since);
    if (connections24Res.error) throw connections24Res.error;

    const connectionsAllRes = await supabase
      .from("dapp_connections")
      .select("id", { count: "exact", head: true });
    if (connectionsAllRes.error) throw connectionsAllRes.error;

    const unique24Res = await supabase.rpc("count_distinct_dapp_connections", { since_ts: since });
    if (unique24Res.error) throw unique24Res.error;

    const uniqueAllRes = await supabase.rpc("count_distinct_dapp_connections", { since_ts: null });
    if (uniqueAllRes.error) throw uniqueAllRes.error;

    const { data: recentConnections, error: recentError } = await supabase
      .from("dapp_connections")
      .select("connected_at,wallet,geo_country,geo_region,geo_city")
      .order("connected_at", { ascending: false })
      .limit(50);
    if (recentError) throw recentError;

    return jsonResponse(origin, 200, {
      ok: true,
      reqId,
      metrics: {
        connections24: connections24Res.count ?? 0,
        connections24Unique: Number(unique24Res.data ?? 0),
        connectionsAll: connectionsAllRes.count ?? 0,
        connectionsAllUnique: Number(uniqueAllRes.data ?? 0),
      },
      recentConnections: recentConnections ?? [],
    }, reqId);
  } catch (err) {
    return jsonResponse(origin, 500, { ok: false, reqId, code: "QUERY_FAILED", error: String((err as Error)?.message ?? err) }, reqId);
  }
});
