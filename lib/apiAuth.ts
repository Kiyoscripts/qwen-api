// One entry point for authenticating a /v1/* request.
//
// External callers send a key, exactly as before. The site's own /chat and
// /playground send nothing and ride the signed session cookie instead, so being
// logged in is enough to use them — no pasting a key into every page.
//
// Cookie auth still resolves to a real api_keys row (created once per account,
// named below), so usage logging and revocation all keep
// working unchanged. The browser never sees that key's plaintext.
//
// Not a CSRF hole: qwen_session is SameSite=Lax, which browsers do not attach to
// cross-site POSTs, and every /v1/* write is a POST.

import { admin, extractApiKey, validateApiKey, createApiKey, type ApiKeyRecord } from "./supabase";
import { currentUser } from "./auth";

export const WEB_KEY_NAME = "Web session";

const COLS = "id, name, key_hash, key_prefix, revoked, expires_at, request_limit, request_count, allowed_models, allowed_ips";

/**
 * The key that backs this account's browser sessions. Found or created once;
 * if the user revokes it from the dashboard a fresh one is issued next request.
 */
export async function webKeyForUser(userId: string): Promise<ApiKeyRecord | null> {
  // limit(1) rather than maybeSingle(): two requests racing on first use can each
  // insert a row, and maybeSingle() errors on more than one match.
  const { data } = await admin()
    .from("api_keys")
    .select(COLS)
    .eq("user_id", userId)
    .eq("name", WEB_KEY_NAME)
    .eq("revoked", false)
    .order("created_at", { ascending: true })
    .limit(1);
  if (data && data.length) return data[0] as ApiKeyRecord;

  try {
    const made = await createApiKey(WEB_KEY_NAME, null, userId);
    const { data: fresh } = await admin().from("api_keys").select(COLS).eq("id", made.id).maybeSingle();
    return (fresh as ApiKeyRecord) || null;
  } catch {
    return null;
  }
}

/** Resolve a request to an API key record: Bearer/x-api-key first, else session. */
function requestIp(req: Request): string {
  return (req.headers.get("x-client-ip") || "").trim();
}

export async function authenticate(req: Request): Promise<ApiKeyRecord | null> {
  const key = extractApiKey(req.headers);
  const record = key ? await validateApiKey(key) : await (async () => {
    const user = await currentUser(req);
    const webKey = user ? await webKeyForUser(user.id) : null;
    if (!webKey) return null;
    const { data } = await admin().rpc("consume_api_key_by_id", { p_id: webKey.id });
    return data?.[0] || null;
  })();
  if (!record) return null;
  if (record.expires_at && Date.parse(record.expires_at) <= Date.now()) return null;
  if (record.request_limit != null && Number(record.request_count || 0) >= Number(record.request_limit)) return null;
  const allowedIps = record.allowed_ips || [];
  if (allowedIps.length && !allowedIps.includes(requestIp(req))) return null;
  return record;
}

export function modelAllowed(record: ApiKeyRecord, model: string): boolean {
  return !record.allowed_models?.length || record.allowed_models.includes(model);
}
