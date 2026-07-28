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
-- Pool of OneCompiler account tokens. Deliberately a SEPARATE table from
-- qwen_tokens rather than one table with a provider column: the two pools have
-- different credentials (Qwen session token vs OneCompiler bearer JWT), different
-- exhaustion behaviour (Qwen rotates on rate-limit, OneCompiler on a hard daily
-- cap) and are managed independently, so a shared table would only invite one
-- provider's rows to be picked for the other.
-- ---------------------------------------------------------------------------
create table if not exists public.onecompiler_tokens (
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
alter table public.onecompiler_tokens  enable row level security;
alter table public.blacklisted_ips     enable row level security;
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

-- ---------------------------------------------------------------------------
-- Accounts (signup system). Custom lightweight auth — no Supabase Auth, no email
-- verification. Passwords are scrypt-hashed server-side. Sessions are signed
-- cookies (no session table). API keys can be attached to a user; keys with NO
-- user are anonymous and auto-deleted after 3 days.
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);
alter table public.users enable row level security;
-- (No policies on purpose — only the service role touches it.)

-- Attach keys to an account. NULL user_id = anonymous (expires in 3 days).
alter table public.api_keys add column if not exists user_id uuid references public.users(id) on delete cascade;
create index if not exists api_keys_user_id_idx on public.api_keys (user_id);

-- ---------------------------------------------------------------------------
-- Discord-based login (replaces email/password). A user links their Discord via
-- the bot's /link command -> gets a code -> enters it on the site -> the site
-- DMs them a login key. They log in with that key. Role (owner/admin/member)
-- comes from their Discord server permissions.
-- ---------------------------------------------------------------------------
alter table public.users add column if not exists discord_id           text unique;
alter table public.users add column if not exists discord_username      text;
alter table public.users add column if not exists discord_global_name   text;
alter table public.users add column if not exists discord_avatar        text;
alter table public.users add column if not exists discord_role          text;  -- owner|admin|member
alter table public.users add column if not exists login_key_hash        text;
alter table public.users add column if not exists updated_at            timestamptz;

-- Email/password are no longer required (Discord is the identity now).
do $$ begin
  if exists (select 1 from information_schema.columns where table_name='users' and column_name='email') then
    alter table public.users alter column email drop not null;
  end if;
  if exists (select 1 from information_schema.columns where table_name='users' and column_name='password_hash') then
    alter table public.users alter column password_hash drop not null;
  end if;
end $$;

create index if not exists users_login_key_hash_idx on public.users (login_key_hash);

-- Short-lived link codes the bot creates for /link.
create table if not exists public.discord_link_codes (
  code                text primary key,
  discord_id          text not null,
  discord_username    text,
  discord_global_name text,
  discord_avatar      text,
  discord_role        text,
  expires_at          timestamptz not null
);
alter table public.discord_link_codes enable row level security;

-- ---------------------------------------------------------------------------
-- DM outbox: the site queues login-key DMs here; the bot POLLS for them (so the
-- bot needs no public URL / open port — it can run anywhere with outbound net).
-- ---------------------------------------------------------------------------
create table if not exists public.discord_dm_queue (
  id          uuid primary key default gen_random_uuid(),
  discord_id  text not null,
  message     text not null,
  status      text not null default 'pending',  -- pending|sent|dms_closed|failed
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);
create index if not exists discord_dm_queue_status_idx on public.discord_dm_queue (status, created_at);
alter table public.discord_dm_queue enable row level security;
