import { randomUUID } from "node:crypto";
import { sql } from "./postgres";
import { cleanupUnlinkedKeys, admin } from "./supabase";
import { getModels } from "./qwen";
import { invalidateTokenCache } from "./tokens";
import { logger, publicError } from "./logger";
import { discoverCustomModels, testCustomProvider } from "./customProviders";
import { getSetting } from "./settings";

type Job = { id:string; type:string; payload:Record<string,unknown>; attempts:number; max_attempts:number };
export const WORKER_ID = `worker_${process.pid}_${randomUUID().slice(0,8)}`;

export async function enqueueJob(type:string,payload:Record<string,unknown>={},options:{runAt?:Date;priority?:number;maxAttempts?:number}={}) {
  const rows=await sql<{id:string}>(`insert into background_jobs(type,payload,run_at,priority,max_attempts) values($1,$2,$3,$4,$5) returning id`,[type,payload,options.runAt||new Date(),options.priority||0,options.maxAttempts||5]);
  return rows[0].id;
}
async function claim():Promise<Job|null>{const rows=await sql<Job>(`select * from claim_background_job($1)`,[WORKER_ID]);return rows[0]||null;}
async function healthToken(id:string){const {data}=await admin().from("qwen_tokens").select("id, token, consecutive_failures").eq("id",id).maybeSingle();if(!data)throw new Error("Token not found");const started=Date.now(),now=new Date().toISOString();try{const models=await getModels(data.token,{bypassCache:true});await admin().from("qwen_tokens").update({last_health_at:now,last_success_at:now,last_error:null,latency_ms:Date.now()-started,consecutive_failures:0}).eq("id",id);return {models:models.length};}catch(error){const failures=Number(data.consecutive_failures||0)+1;await admin().from("qwen_tokens").update({last_health_at:now,last_failure_at:now,last_error:String((error as Error).message||error).slice(0,500),latency_ms:Date.now()-started,consecutive_failures:failures,...(failures>=3?{active:false}:{})}).eq("id",id);if(failures>=3)invalidateTokenCache();throw error;}}
async function run(job:Job){if(job.type==="cleanup.keys")return {deleted:await cleanupUnlinkedKeys()};if(job.type==="qwen.health")return healthToken(String(job.payload.token_id||""));if(job.type==="custom_provider.health")return testCustomProvider(String(job.payload.provider_id||""));if(job.type==="custom_provider.discover")return {models:await discoverCustomModels(String(job.payload.provider_id||""))};throw new Error(`Unknown job type: ${job.type}`);}
export async function processOneJob(){const job=await claim();if(!job)return null;try{const result=await run(job);await sql(`update background_jobs set status='completed',completed_at=now(),updated_at=now(),locked_at=null,locked_by=null,last_error=null where id=$1`,[job.id]);logger.info("job.completed",{job_id:job.id,job_type:job.type,attempt:job.attempts});return {id:job.id,type:job.type,status:"completed",result};}catch(error){const terminal=job.attempts>=job.max_attempts,delay=Math.min(3600,Math.pow(2,Math.max(0,job.attempts-1))*30);await sql(`update background_jobs set status=$2,run_at=case when $2='queued' then now()+($3||' seconds')::interval else run_at end,updated_at=now(),locked_at=null,locked_by=null,last_error=$4 where id=$1`,[job.id,terminal?"failed":"queued",delay,String((error as Error).message||error).slice(0,1000)]);logger[terminal?"error":"warn"]("job.failed",{job_id:job.id,job_type:job.type,attempt:job.attempts,retry_in_seconds:terminal?null:delay,...publicError(error)});return {id:job.id,type:job.type,status:terminal?"failed":"queued"};}}

export async function scheduleCustomProviderJobs(now=new Date()) {
  const settings=await getSetting("custom_providers");
  const providers=await sql<{id:string;last_health_at:string|null;last_discovery_at:string|null}>(`select p.id,max(c.last_health_at)::text last_health_at,max(m.last_seen_at)::text last_discovery_at from custom_providers p left join custom_provider_credentials c on c.provider_id=p.id left join custom_provider_models m on m.provider_id=p.id where p.active group by p.id`);
  let queued=0;
  for(const provider of providers){
    const jobs:[string,string|null,number][]=[["custom_provider.health",provider.last_health_at,settings.health_interval_minutes],["custom_provider.discover",provider.last_discovery_at,settings.discovery_interval_minutes]];
    for(const [type,last,minutes] of jobs){
      if(last && now.getTime()-new Date(last).getTime()<minutes*60_000)continue;
      const rows=await sql<{id:string}>(`insert into background_jobs(type,payload,run_at,priority,max_attempts) values($1,jsonb_build_object('provider_id',$2::text),$3,0,5) on conflict (type,(payload->>'provider_id')) where status in ('queued','running') and type in ('custom_provider.health','custom_provider.discover') do nothing returning id`,[type,provider.id,now]);
      queued+=rows.length;
    }
  }
  return queued;
}
