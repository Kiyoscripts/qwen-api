alter table public.usage_logs add column if not exists request_id text;
alter table public.usage_logs add column if not exists latency_ms integer check(latency_ms is null or latency_ms>=0);
alter table public.usage_logs add column if not exists provider_attempts integer not null default 1 check(provider_attempts>0);
alter table public.usage_logs add column if not exists failure_category text;
alter table public.usage_logs add column if not exists provider text not null default 'qwen';
create index if not exists usage_logs_model_created_idx on public.usage_logs(model,created_at);
create index if not exists usage_logs_status_created_idx on public.usage_logs(status,created_at);
create index if not exists usage_logs_failure_created_idx on public.usage_logs(failure_category,created_at) where failure_category is not null;
