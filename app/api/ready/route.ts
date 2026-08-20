import { NextResponse } from "next/server";
import { postgresHealth } from "@/lib/postgres";
import { tokenPoolStatus } from "@/lib/tokens";
import { customProviderCapacity } from "@/lib/customProviders";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(req: Request) { const id=req.headers.get("x-request-id")||"req_unknown"; const [database,pool,custom]=await Promise.all([postgresHealth(),tokenPoolStatus().catch(()=>({total:0,available:0,parked:0,expired:0})),customProviderCapacity().catch(()=>({providers:0,models:0,credentials:0,parked:0}))]); const customReady=custom.models>0&&custom.credentials>0,providerReady=pool.available>0||customReady,ready=database.ok&&providerReady; return NextResponse.json({status:ready?"ready":"not_ready",checks:{database:{ok:database.ok,latency_ms:database.latency_ms},provider_capacity:{ok:providerReady,qwen:{available:pool.available,total:pool.total,parked:pool.parked,expired:pool.expired},custom:{ok:customReady,...custom}}},timestamp:new Date().toISOString()},{status:ready?200:503,headers:{"Cache-Control":"no-store","X-Request-ID":id}}); }
