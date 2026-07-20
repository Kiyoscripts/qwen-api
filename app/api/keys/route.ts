import { NextRequest, NextResponse } from "next/server";
import { createApiKey } from "@/lib/supabase";

export const runtime = "nodejs";

// PUBLIC: anyone can generate an API key (self-serve signup). The raw key is
// returned once and only its hash is stored.
export async function POST(req: NextRequest) {
  let name: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.name === "string") name = body.name.slice(0, 80);
  } catch {
    /* name is optional */
  }
  try {
    const created = await createApiKey(name);
    return NextResponse.json({
      key: created.key,
      id: created.id,
      name,
      note: "Save this key now — it is shown only once and cannot be retrieved again.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
