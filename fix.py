p='lib/jobs.ts'
s=open(p).read()
s=s.replace('sql<{id:string;last_health_at:string|null;last_discovery_at:string|null}>();', "sql<{id:string;last_health_at:string|null;last_discovery_at:string|null}>(`select p.id,max(c.last_health_at)::text last_health_at,max(m.last_seen_at)::text last_discovery_at from custom_providers p left join custom_provider_credentials c on c.provider_id=p.id left join custom_provider_models m on m.provider_id=p.id where p.active group by p.id`);")
s=s.replace('sql<{id:string}>(,[type,provider.id,now]);', "sql<{id:string}>(`insert into background_jobs(type,payload,run_at,priority,max_attempts) values($1,jsonb_build_object('provider_id',$2::text),$3,0,5) on conflict (type,(payload->>'provider_id')) where status in ('queued','running') and type in ('custom_provider.health','custom_provider.discover') do nothing returning id`,[type,provider.id,now]);")
open(p,'w').write(s)
