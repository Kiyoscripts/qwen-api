create or replace function public.consume_api_key(p_key_hash text)
returns table(id uuid, name text, key_hash text, key_prefix text, revoked boolean, expires_at timestamptz, request_limit bigint, request_count bigint, allowed_models text[], allowed_ips text[])
language plpgsql security definer set search_path=public as $$
begin
  return query update api_keys k set request_count=k.request_count+1,last_used_at=now()
  where k.key_hash=p_key_hash and not k.revoked and (k.expires_at is null or k.expires_at>now())
    and (k.request_limit is null or k.request_count<k.request_limit)
  returning k.id,k.name,k.key_hash,k.key_prefix,k.revoked,k.expires_at,k.request_limit,k.request_count,k.allowed_models,k.allowed_ips;
end $$;
create or replace function public.consume_api_key_by_id(p_id uuid)
returns table(id uuid, name text, key_hash text, key_prefix text, revoked boolean, expires_at timestamptz, request_limit bigint, request_count bigint, allowed_models text[], allowed_ips text[])
language plpgsql security definer set search_path=public as $$
begin
 return query update api_keys k set request_count=k.request_count+1,last_used_at=now() where k.id=p_id and not k.revoked and (k.expires_at is null or k.expires_at>now()) and (k.request_limit is null or k.request_count<k.request_limit) returning k.id,k.name,k.key_hash,k.key_prefix,k.revoked,k.expires_at,k.request_limit,k.request_count,k.allowed_models,k.allowed_ips;
end $$;
