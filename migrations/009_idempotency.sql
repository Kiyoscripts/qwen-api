create table if not exists public.idempotency_records (
 id uuid primary key default gen_random_uuid(), api_key_id uuid not null references public.api_keys(id) on delete cascade,
 endpoint text not null, idempotency_key text not null, request_hash text not null, status text not null default 'processing' check(status in('processing','completed')),
 response_status integer, response_headers jsonb, response_body bytea, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '24 hours',
 unique(api_key_id,endpoint,idempotency_key)
);
create index if not exists idempotency_expiry_idx on public.idempotency_records(expires_at);
