import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";
export async function GET(req: NextRequest) { const auth = await requireAdmin(req); if (auth.response) return auth.response; const { data, error } = await admin().from("admin_audit_logs").select("id, actor_id, action, target_type, target_id, details, created_at").order("created_at", { ascending: false }).limit(500); return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ logs: data || [] }); }
