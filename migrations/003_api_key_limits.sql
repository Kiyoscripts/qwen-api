alter table public.api_keys add column if not exists expires_at timestamptz;
alter table public.api_keys add column if not exists request_limit bigint;
alter table public.api_keys add column if not exists allowed_models text[];
alter table public.api_keys add column if not exists allowed_ips text[];
create index if not exists api_keys_expires_at_idx on public.api_keys(expires_at) where expires_at is not null;
