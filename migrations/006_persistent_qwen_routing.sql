alter table public.qwen_tokens add column if not exists parked_until timestamptz;
alter table public.qwen_tokens add column if not exists last_selected_at timestamptz;
alter table public.qwen_tokens add column if not exists last_failure_code text;
alter table public.qwen_tokens add column if not exists consecutive_routing_failures integer not null default 0;

create index if not exists qwen_tokens_routing_idx
  on public.qwen_tokens (active, parked_until, last_selected_at);

create or replace function public.claim_qwen_token(p_exclude_ids uuid[] default '{}')
returns table(id uuid, token text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidate as (
    select q.id
    from public.qwen_tokens q
    where q.active
      and (q.parked_until is null or q.parked_until <= now())
      and not (q.id = any(coalesce(p_exclude_ids, '{}'::uuid[])))
    order by q.last_selected_at asc nulls first, q.created_at asc
    for update skip locked
    limit 1
  )
  update public.qwen_tokens q
  set last_selected_at = now(), last_used_at = now()
  from candidate c
  where q.id = c.id
  returning q.id, q.token;
end $$;

revoke all on function public.claim_qwen_token(uuid[]) from public;
