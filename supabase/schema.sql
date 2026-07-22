-- Qwen3.8 API — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
--
-- Stores hashed API keys and (optionally) per-request usage. The API server talks
-- to Supabase with the SERVICE ROLE key, which bypasses RLS. RLS is enabled with
-- NO policies so the anon / publishable keys can never read these tables.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- API keys
-- ---------------------------------------------------------------------------
create table if not exists public.api_keys (
  id             uuid primary key default gen_random_uuid(),
  name           text,                                   -- human label, e.g. "prod app"
  key_hash       text not null unique,                   -- sha256(secret key), never the raw key
  key_prefix     text not null,                          -- first chars for display, e.g. "qwen_sk_ab12…"
  created_at     timestamptz not null default now(),
  created_ip     text,                                   -- client IP at creation (for rate limiting)
  last_used_at   timestamptz,
  revoked        boolean not null default false,
  request_count  bigint not null default 0
);

-- If the table already existed without created_ip, add it:
alter table public.api_keys add column if not exists created_ip text;

create index if not exists api_keys_key_hash_idx on public.api_keys (key_hash);
create index if not exists api_keys_created_ip_idx on public.api_keys (created_ip, created_at);

-- ---------------------------------------------------------------------------
-- Usage log (optional, handy for basic analytics / rate thinking)
-- ---------------------------------------------------------------------------
create table if not exists public.usage_logs (
  id           bigint generated always as identity primary key,
  api_key_id   uuid references public.api_keys(id) on delete set null,
  created_at   timestamptz not null default now(),
  model        text,
  had_image    boolean not null default false,
  streamed     boolean not null default false,
  status       int
);

create index if not exists usage_logs_api_key_id_idx on public.usage_logs (api_key_id);
create index if not exists usage_logs_created_at_idx on public.usage_logs (created_at);

-- ---------------------------------------------------------------------------
-- DeepSeek "bring your own token" links. Each API key may link its owner's own
-- chat.deepseek.com token (used server-side only, never returned to a client).
-- ---------------------------------------------------------------------------
create table if not exists public.deepseek_user_tokens (
  api_key_id  uuid primary key references public.api_keys(id) on delete cascade,
  token       text not null,
  linked_at   timestamptz not null default now(),
  last_error  text
);

-- ---------------------------------------------------------------------------
-- Blacklisted IPs (auto-banned for mass key creation, or added by an admin).
-- ---------------------------------------------------------------------------
create table if not exists public.blacklisted_ips (
  ip            text primary key,
  reason        text,
  keys_deleted  int not null default 0,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Pool of Qwen account tokens the API rotates across (managed in the admin
-- dashboard). Spreads load so no single account gets rate-limited / flagged.
-- ---------------------------------------------------------------------------
create table if not exists public.qwen_tokens (
  id           uuid primary key default gen_random_uuid(),
  label        text,
  token        text not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  error_count  int not null default 0
);

-- ---------------------------------------------------------------------------
-- Lock everything down: only the service role (used by the API server) may
-- access these tables. anon / publishable keys get nothing.
-- ---------------------------------------------------------------------------
alter table public.api_keys            enable row level security;
alter table public.usage_logs          enable row level security;
alter table public.qwen_tokens         enable row level security;
alter table public.blacklisted_ips     enable row level security;
alter table public.deepseek_user_tokens enable row level security;
-- (No policies are created on purpose. Service role bypasses RLS.)

-- ---------------------------------------------------------------------------
-- Atomically bump usage counters when a key is used. Called via RPC.
-- ---------------------------------------------------------------------------
create or replace function public.touch_api_key(p_key_hash text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.api_keys
     set last_used_at = now(),
         request_count = request_count + 1
   where key_hash = p_key_hash;
$$;
