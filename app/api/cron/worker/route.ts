import { NextResponse } from "next/server";
import { processOneJob, scheduleCustomProviderJobs } from "@/lib/jobs";
export const runtime="nodejs";export const maxDuration=300;
export async function POST(req:Request){const secret=process.env.CRON_SECRET;if(!secret||req.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"unauthorized"},{status:401});await scheduleCustomProviderJobs();const count=Math.min(25,Math.max(1,Number(new URL(req.url).searchParams.get("limit")||5))),jobs=[];for(let i=0;i<count;i++){const job=await processOneJob();if(!job)break;jobs.push(job);}return NextResponse.json({ok:true,processed:jobs.length,jobs});}
export const GET=POST;
