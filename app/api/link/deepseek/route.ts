import { NextRequest, NextResponse } from "next/server";
import { extractApiKey, validateApiKey, setDeepSeekToken, deleteDeepSeekToken, isDeepSeekLinked } from "@/lib/supabase";
import { validateDeepSeekToken } from "@/lib/deepseek";

export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

// Link a user's own chat.deepseek.com token to their API key. The token is tested
// live against DeepSeek before it's saved, so an expired/wrong token fails here
// with clear guidance instead of failing later mid-chat.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON: { apiKey, token }" }, 400);
  }
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  // Users often paste the whole "Bearer xxx" — strip it.
  let token = typeof body?.token === "string" ? body.token.trim() : "";
  token = token.replace(/^Bearer\s+/i, "").trim();

  if (!apiKey) return json({ error: "Enter your API key." }, 400);
  if (!token) return json({ error: "Enter your DeepSeek token." }, 400);

  const record = await validateApiKey(apiKey);
  if (!record) return json({ error: "That API key is invalid or revoked. Generate one on the homepage first." }, 401);

  const ok = await validateDeepSeekToken(token);
  if (!ok) {
    return json(
      { error: "DeepSeek rejected that token (it may be stale or expired). Grab a fresh one from the Network tab (see the guide) and try again." },
      400
    );
  }

  try {
    await setDeepSeekToken(record.id, token);
  } catch (e: any) {
    return json({ error: e.message || "Could not save the link." }, 500);
  }
  return json({ linked: true, message: "Linked! You can now use the deepseek-* models with this API key." });
}

// Link status for an API key (Authorization: Bearer <apiKey>). Never returns the token.
export async function GET(req: NextRequest) {
  const apiKey = extractApiKey(req.headers);
  if (!apiKey) return json({ error: "Send Authorization: Bearer <apiKey>" }, 401);
  const record = await validateApiKey(apiKey);
  if (!record) return json({ error: "Invalid API key." }, 401);
  const linked = await isDeepSeekLinked(record.id);
  return json({ linked });
}

// Unlink (Authorization: Bearer <apiKey>).
export async function DELETE(req: NextRequest) {
  const apiKey = extractApiKey(req.headers);
  if (!apiKey) return json({ error: "Send Authorization: Bearer <apiKey>" }, 401);
  const record = await validateApiKey(apiKey);
  if (!record) return json({ error: "Invalid API key." }, 401);
  await deleteDeepSeekToken(record.id);
  return json({ linked: false });
}
