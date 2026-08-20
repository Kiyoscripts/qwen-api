create table public.custom_providers (
 id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique check(slug ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
 base_url text not null, active boolean not null default false, models_path text not null default '/v1/models', chat_path text not null default '/v1/chat/completions',
 request_timeout_ms integer not null default 60000 check(request_timeout_ms between 1000 and 300000), supports_streaming boolean not null default true,
 model_discovery_enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.custom_provider_credentials (
 id uuid primary key default gen_random_uuid(), provider_id uuid not null references public.custom_providers(id) on delete cascade,
 secret_ciphertext text not null, secret_prefix text not null, active boolean not null default true, priority integer not null default 0,
 expires_at timestamptz, parked_until timestamptz, last_selected_at timestamptz, last_health_at timestamptz, last_success_at timestamptz,
 last_failure_at timestamptz, last_failure_code text, latency_ms integer, consecutive_failures integer not null default 0, created_at timestamptz not null default now()
);
create table public.custom_provider_models (
 id uuid primary key default gen_random_uuid(), provider_id uuid not null references public.custom_providers(id) on delete cascade,
 upstream_model_id text not null, public_model_id text not null unique, display_name text not null, active boolean not null default false,
 supports_streaming boolean not null default true, context_length integer, last_seen_at timestamptz not null default now(), created_at timestamptz not null default now(),
 unique(provider_id,upstream_model_id)
);
create index custom_credentials_claim_idx on public.custom_provider_credentials(provider_id,active,parked_until,priority desc,last_selected_at);
create index custom_models_provider_idx on public.custom_provider_models(provider_id,active);
create or replace function public.claim_custom_provider_credential(p_provider_id uuid,p_exclude_ids uuid[] default '{}') returns table(id uuid,secret_ciphertext text)
language plpgsql security definer set search_path=public as $$ begin return query with candidate as (select c.id from custom_provider_credentials c where c.provider_id=p_provider_id and c.active and (c.expires_at is null or c.expires_at>now()) and (c.parked_until is null or c.parked_until<=now()) and not(c.id=any(coalesce(p_exclude_ids,'{}'::uuid[]))) order by c.priority desc,c.last_selected_at asc nulls first for update skip locked limit 1) update custom_provider_credentials c set last_selected_at=now() from candidate x where c.id=x.id returning c.id,c.secret_ciphertext; end $$;
revoke all on function public.claim_custom_provider_credential(uuid,uuid[]) from public;
