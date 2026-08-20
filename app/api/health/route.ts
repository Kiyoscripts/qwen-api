import { NextResponse } from "next/server";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(req: Request) { const id=req.headers.get("x-request-id")||"req_unknown"; return NextResponse.json({status:"ok",service:"qwen38-api",uptime_seconds:Math.floor(process.uptime()),timestamp:new Date().toISOString()},{headers:{"Cache-Control":"no-store","X-Request-ID":id}}); }
