create table if not exists public.auth_sessions (
  id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  ip_address text,
  user_agent text
);
create index if not exists auth_sessions_user_active_idx on public.auth_sessions(user_id, expires_at) where revoked_at is null;
