alter table public.qwen_tokens add column if not exists last_health_at timestamptz;
alter table public.qwen_tokens add column if not exists last_success_at timestamptz;
alter table public.qwen_tokens add column if not exists last_failure_at timestamptz;
alter table public.qwen_tokens add column if not exists last_error text;
alter table public.qwen_tokens add column if not exists latency_ms int;
alter table public.qwen_tokens add column if not exists expires_at timestamptz;
alter table public.qwen_tokens add column if not exists consecutive_failures int not null default 0;
