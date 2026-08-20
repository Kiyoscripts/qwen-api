alter table public.api_keys add column if not exists revoke_at timestamptz;
alter table public.api_keys add column if not exists rotated_to uuid references public.api_keys(id) on delete set null;
create index if not exists api_keys_revoke_at_idx on public.api_keys(revoke_at) where revoke_at is not null and not revoked;

create or replace function public.consume_api_key(p_key_hash text)
returns table(id uuid,name text,key_hash text,key_prefix text,revoked boolean,expires_at timestamptz,request_limit bigint,request_count bigint,allowed_models text[],allowed_ips text[])
language plpgsql security definer set search_path=public as $$ begin return query update api_keys k set request_count=k.request_count+1,last_used_at=now(),revoked=case when k.revoke_at is not null and k.revoke_at<=now() then true else k.revoked end where k.key_hash=p_key_hash and not k.revoked and (k.revoke_at is null or k.revoke_at>now()) and (k.expires_at is null or k.expires_at>now()) and (k.request_limit is null or k.request_count<k.request_limit) returning k.id,k.name,k.key_hash,k.key_prefix,k.revoked,k.expires_at,k.request_limit,k.request_count,k.allowed_models,k.allowed_ips; end $$;
create or replace function public.consume_api_key_by_id(p_id uuid)
returns table(id uuid,name text,key_hash text,key_prefix text,revoked boolean,expires_at timestamptz,request_limit bigint,request_count bigint,allowed_models text[],allowed_ips text[])
language plpgsql security definer set search_path=public as $$ begin return query update api_keys k set request_count=k.request_count+1,last_used_at=now(),revoked=case when k.revoke_at is not null and k.revoke_at<=now() then true else k.revoked end where k.id=p_id and not k.revoked and (k.revoke_at is null or k.revoke_at>now()) and (k.expires_at is null or k.expires_at>now()) and (k.request_limit is null or k.request_count<k.request_limit) returning k.id,k.name,k.key_hash,k.key_prefix,k.revoked,k.expires_at,k.request_limit,k.request_count,k.allowed_models,k.allowed_ips; end $$;
revoke all on function public.consume_api_key(text) from public;
revoke all on function public.consume_api_key_by_id(uuid) from public;
