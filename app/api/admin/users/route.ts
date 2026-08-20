import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/supabase";
import { audit, hashPassword, normalizeUsername, requireAdmin } from "@/lib/auth";

const COLS = "id, username, role, disabled, created_at, updated_at";
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req); if (auth.response) return auth.response;
  const { data, error } = await admin().from("users").select(COLS).order("created_at", { ascending: false }).limit(1000);
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ users: data || [] });
}
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req); if (auth.response) return auth.response;
  try {
    const body = await req.json(); const username = normalizeUsername(String(body.username || ""));
    const password_hash = await hashPassword(String(body.password || "")); const role = body.role === "admin" ? "admin" : "user";
    const { data, error } = await admin().from("users").insert({ username, password_hash, role }).select(COLS).single();
    if (error) throw new Error(error.message); await audit(auth.user.id, "user.create", "user", data.id, { username, role });
    return NextResponse.json({ user: data });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req); if (auth.response) return auth.response;
  try {
    const body = await req.json(); if (!body.id) throw new Error("id required");
    const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.disabled === "boolean") fields.disabled = body.disabled;
    if (body.role === "admin" || body.role === "user") fields.role = body.role;
    if (body.password) fields.password_hash = await hashPassword(String(body.password));
    if (body.id === auth.user.id && (fields.disabled === true || fields.role === "user")) throw new Error("You cannot disable or demote your own account.");
    const { data: target } = await admin().from("users").select("role, disabled").eq("id", body.id).maybeSingle();
    if (target?.role === "admin" && !target.disabled && (fields.disabled === true || fields.role === "user")) {
      const { count } = await admin().from("users").select("id", { count: "exact", head: true }).eq("role", "admin").eq("disabled", false);
      if ((count || 0) <= 1) throw new Error("The final enabled administrator cannot be disabled or demoted.");
    }
    const { data, error } = await admin().from("users").update(fields).eq("id", body.id).select(COLS).single();
    if (error) throw new Error(error.message); await audit(auth.user.id, "user.update", "user", body.id, Object.keys(fields));
    return NextResponse.json({ user: data });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req); if (auth.response) return auth.response;
  const id = req.nextUrl.searchParams.get("id"); if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (id === auth.user.id) return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  const { data: target } = await admin().from("users").select("role, disabled").eq("id", id).maybeSingle();
  if (target?.role === "admin" && !target.disabled) {
    const { count } = await admin().from("users").select("id", { count: "exact", head: true }).eq("role", "admin").eq("disabled", false);
    if ((count || 0) <= 1) return NextResponse.json({ error: "The final enabled administrator cannot be deleted." }, { status: 400 });
  }
  const { error } = await admin().from("users").delete().eq("id", id); if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await audit(auth.user.id, "user.delete", "user", id); return NextResponse.json({ ok: true });
}
