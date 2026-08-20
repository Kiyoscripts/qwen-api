create table if not exists public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  priority integer not null default 0,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists background_jobs_claim_idx on public.background_jobs(status, run_at, priority desc, created_at);

create or replace function public.claim_background_job(p_worker text)
returns setof public.background_jobs
language plpgsql security definer set search_path=public as $$
begin
  return query
  with candidate as (
    select j.id from public.background_jobs j
    where (j.status='queued' and j.run_at<=now())
       or (j.status='running' and j.locked_at<now()-interval '15 minutes')
    order by j.priority desc,j.run_at,j.created_at
    for update skip locked limit 1
  )
  update public.background_jobs j set status='running',attempts=j.attempts+1,locked_at=now(),locked_by=p_worker,updated_at=now()
  from candidate c where j.id=c.id returning j.*;
end $$;
revoke all on function public.claim_background_job(text) from public;
