export function corsHeaders(origin?: string) {
  const allowListRaw = Deno.env.get("CORS_ALLOW_ORIGIN") ?? "";
  const allowList = allowListRaw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  let resolvedOrigin = "*";
  if (allowList.length > 0 && origin) {
    resolvedOrigin = allowList.includes(origin) ? origin : "*";
  }

  return {
    "Access-Control-Allow-Origin": resolvedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

export function handleOptions(req: Request) {
  const origin = req.headers.get("origin") ?? undefined;
  return new Response("ok", { headers: corsHeaders(origin), status: 200 });
}
