import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import "dotenv/config";

const raw = process.env.DATABASE_URL;
if (!raw) throw new Error("DATABASE_URL is required for database integration tests.");
const insecure = process.env.DATABASE_SSL_NO_VERIFY === "true";
const url = new URL(raw); if (insecure) url.searchParams.delete("sslmode");
const config = { connectionString:url.toString(), ssl:insecure?{rejectUnauthorized:false}:undefined };
const admin = new pg.Client(config); await admin.connect();
const ids={user:"",key:"",tokens:[] as string[],jobs:[] as string[]};
async function parallel<T>(count:number,fn:(c:pg.PoolClient,i:number)=>Promise<T>){const pool=new pg.Pool({...config,max:8});try{return await Promise.all(Array.from({length:count},async(_,i)=>{const c=await pool.connect();try{return await fn(c,i);}finally{c.release();}}));}finally{await pool.end();}}
try {
  const user=(await admin.query(`insert into users(email,username,password_hash,role) values($1,$2,'integration-test','user') returning id`,[`integration-${randomUUID()}@invalid`, `integration-${randomUUID()}`])).rows[0];ids.user=user.id;
  const keyHash=`integration-${randomUUID()}`;const key=(await admin.query(`insert into api_keys(name,key_hash,key_prefix,user_id,request_limit) values('integration-test',$1,'test...', $2,7) returning id`,[keyHash,user.id])).rows[0];ids.key=key.id;
  const consumed=await parallel(24,(c,i)=>c.query(i%2?`select * from consume_api_key($1)`:`select * from consume_api_key_by_id($1)`,[i%2?keyHash:key.id]));
  assert.equal(consumed.reduce((n,r)=>n+r.rowCount,0),7,"quota must permit exactly request_limit claims");assert.equal(Number((await admin.query(`select request_count from api_keys where id=$1`,[key.id])).rows[0].request_count),7);

  const existing=(await admin.query(`select coalesce(array_agg(id),'{}'::uuid[]) ids from qwen_tokens`)).rows[0].ids;
  for(let i=0;i<4;i++)ids.tokens.push((await admin.query(`insert into qwen_tokens(label,token,active) values($1,$2,true) returning id`,[`integration-${i}`,`integration-token-${randomUUID()}`])).rows[0].id);
  const claims=await parallel(4,(c)=>c.query(`select id from claim_qwen_token($1::uuid[])`,[existing]));const claimed=claims.flatMap(r=>r.rows.map(x=>x.id));assert.equal(claimed.length,4);assert.equal(new Set(claimed).size,4,"concurrent token claims must be distinct when capacity exists");

  for(let i=0;i<4;i++)ids.jobs.push((await admin.query(`insert into background_jobs(type,payload,priority) values('integration-test',$1,2147483647) returning id`,[{nonce:randomUUID()}])).rows[0].id);
  const jobs=await parallel(4,(c,i)=>c.query(`select id from claim_background_job($1)`,[`integration-worker-${i}`]));const claimedJobs=jobs.flatMap(r=>r.rows.map(x=>x.id));assert.equal(claimedJobs.length,4);assert.equal(new Set(claimedJobs).size,4,"jobs must be claimed once");assert.ok(claimedJobs.every(id=>ids.jobs.includes(id)),"integration jobs must win by priority");

  const { rotateApiKey }=await import("../lib/supabase");const rotationSource=(await admin.query(`insert into api_keys(name,key_hash,key_prefix,user_id,request_limit,allowed_models,allowed_ips) values('rotate-test',$1,'rotate...', $2,99,array['model-a'],array['192.0.2.1']) returning id`,[`rotate-${randomUUID()}`,user.id])).rows[0];
  const rotated=await rotateApiKey(user.id,rotationSource.id,5);const rows=(await admin.query(`select id,request_limit,allowed_models,allowed_ips,revoke_at,rotated_to from api_keys where id=any($1::uuid[])`,[[rotationSource.id,rotated.id]])).rows;const old=rows.find(x=>x.id===rotationSource.id),fresh=rows.find(x=>x.id===rotated.id);assert.equal(old.rotated_to,rotated.id);assert.ok(new Date(old.revoke_at).getTime()>Date.now());assert.equal(Number(fresh.request_limit),99);assert.deepEqual(fresh.allowed_models,["model-a"]);await assert.rejects(()=>rotateApiKey(user.id,rotationSource.id,5),/already been rotated/);

  const { claimIdempotency,completeIdempotency,abandonIdempotency }=await import("../lib/idempotency");const endpoint=`/integration/${randomUUID()}`,idemKey=randomUUID(),request=(body:unknown)=>new Request("http://test",{method:"POST",headers:{"Idempotency-Key":idemKey},body:JSON.stringify(body)});const first=await claimIdempotency(request({a:1}),key.id,endpoint,{a:1});assert.equal(first.kind,"new");if(first.kind!=="new")throw new Error("unreachable");const concurrent=await claimIdempotency(request({a:1}),key.id,endpoint,{a:1});assert.equal(concurrent.kind,"conflict");const changed=await claimIdempotency(request({a:2}),key.id,endpoint,{a:2});assert.equal(changed.kind,"conflict");await completeIdempotency(first.id,new Response(Buffer.from([1,2,3]),{status:201,headers:{"Content-Type":"application/octet-stream"}}));const replay=await claimIdempotency(request({a:1}),key.id,endpoint,{a:1});assert.equal(replay.kind,"replay");if(replay.kind==="replay"){assert.equal(replay.response.status,201);assert.equal(replay.response.headers.get("Idempotent-Replayed"),"true");assert.deepEqual([...new Uint8Array(await replay.response.arrayBuffer())],[1,2,3]);}
  const abandoned=await claimIdempotency(new Request("http://test",{headers:{"Idempotency-Key":randomUUID()}}),key.id,endpoint,{b:1});if(abandoned.kind!=="new")throw new Error("expected new abandoned claim");await abandonIdempotency(abandoned.id);assert.equal((await admin.query(`select count(*) from idempotency_records where id=$1`,[abandoned.id])).rows[0].count,"0");
  await admin.query(`update idempotency_records set expires_at=now()-interval '1 second' where id=$1`,[first.id]);const reused=await claimIdempotency(request({a:3}),key.id,endpoint,{a:3});assert.equal(reused.kind,"new","expired idempotency keys must be reusable");

  const { recordSecurityEvent }=await import("../lib/securityEvents");const eventType=`integration-${randomUUID()}`;await Promise.all(Array.from({length:12},()=>recordSecurityEvent({type:eventType,category:"authentication",severity:"medium",sourceIp:"192.0.2.10",route:"/integration"})));const events=(await admin.query(`select occurrence_count from security_events where event_type=$1`,[eventType])).rows;assert.equal(events.length,1,"concurrent equivalent events must deduplicate");assert.equal(events[0].occurrence_count,12);

  const adminRows=[];for(let i=0;i<2;i++)adminRows.push((await admin.query(`insert into users(email,username,password_hash,role) values($1,$2,'integration-test','admin') returning id`,[`admin-${randomUUID()}@invalid`,`admin-${randomUUID()}`])).rows[0].id);const demotions=await parallel(2,(c,i)=>c.query(`update users set role='user' where id=$1`,[adminRows[i]]).then(()=>true,()=>false));assert.ok(demotions.some(Boolean));const enabledAdmins=Number((await admin.query(`select count(*) from users where role='admin' and not disabled`)).rows[0].count);assert.ok(enabledAdmins>=1,"concurrent mutations must preserve an enabled administrator");await admin.query(`delete from users where id=any($1::uuid[])`,[adminRows]);
  console.log("database concurrency tests passed");
} finally {
  if(ids.jobs.length)await admin.query(`delete from background_jobs where id=any($1::uuid[])`,[ids.jobs]).catch(()=>{});
  if(ids.tokens.length)await admin.query(`delete from qwen_tokens where id=any($1::uuid[])`,[ids.tokens]).catch(()=>{});
  if(ids.user)await admin.query(`delete from users where id=$1`,[ids.user]).catch(()=>{});
  await admin.end();
}
