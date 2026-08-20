import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { admin, listUserKeys, createRestrictedApiKey } from "@/lib/supabase";
import { isIP } from "node:net";
import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";

// GET  -> the signed-in user's keys.
export async function GET(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ keys: await listUserKeys(user.id) });
}

export async function PATCH(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const requestLimit = body.request_limit == null || body.request_limit === "" ? null : Number(body.request_limit);
  const expiresAt = body.expires_at ? new Date(body.expires_at) : null;
  if (requestLimit != null && (!Number.isInteger(requestLimit) || requestLimit < 0)) return NextResponse.json({ error: "Invalid request limit." }, { status: 400 });
  if (expiresAt && Number.isNaN(expiresAt.getTime())) return NextResponse.json({ error: "Invalid expiration date." }, { status: 400 });
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && Boolean(x.trim())).map(x => x.trim()) : [];
  const models = strings(body.allowed_models); const ips = strings(body.allowed_ips);
  const { data, error } = await admin().from("api_keys").update({ request_limit: requestLimit, expires_at: expiresAt?.toISOString() || null, allowed_models: models.length ? models : null, allowed_ips: ips.length ? ips : null }).eq("id", id).eq("user_id", user.id).eq("revoked", false).select("id").maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Key not found or revoked." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// POST { name? } -> create a new key attached to the account (shown once).
export async function POST(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : null;
  const quota = (await getSetting("defaults")).quota;
  const requestLimit = body.request_limit == null || body.request_limit === "" ? (quota || null) : Number(body.request_limit);
  const expiresAt = body.expires_at ? new Date(body.expires_at) : null;
  const strings = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((x): x is string => typeof x === "string" && Boolean(x.trim())).map(x => x.trim()))] : [];
  const allowedModels = strings(body.allowed_models), allowedIps = strings(body.allowed_ips);
  if (requestLimit != null && (!Number.isInteger(requestLimit) || requestLimit < 0)) return NextResponse.json({ error: "Request limit must be a non-negative integer." }, { status: 400 });
  if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())) return NextResponse.json({ error: "Expiration must be a valid future date." }, { status: 400 });
  if (allowedModels.some((model) => model.length > 120)) return NextResponse.json({ error: "Invalid model ID." }, { status: 400 });
  if (allowedIps.some((ip) => isIP(ip) === 0)) return NextResponse.json({ error: "Allowed IPs must be valid IPv4 or IPv6 addresses." }, { status: 400 });
  try { return NextResponse.json(await createRestrictedApiKey({ name, userId:user.id, requestLimit, expiresAt:expiresAt?.toISOString()||null, allowedModels:allowedModels.length?allowedModels:null, allowedIps:allowedIps.length?allowedIps:null })); }
  catch { return NextResponse.json({ error: "Could not create the key." }, { status: 500 }); }
}
