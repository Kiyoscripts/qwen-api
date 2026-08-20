create table if not exists public.security_events (
 id bigint generated always as identity primary key,
 event_type text not null, category text not null, severity text not null check(severity in('low','medium','high','critical')),
 actor_id uuid references public.users(id) on delete set null, source_ip inet, target_type text, target_id text,
 request_id text, route text, details jsonb not null default '{}'::jsonb, occurrence_count integer not null default 1,
 first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
 status text not null default 'open' check(status in('open','acknowledged','resolved')), resolved_at timestamptz, resolved_by uuid references public.users(id) on delete set null
);
create index if not exists security_events_status_seen_idx on public.security_events(status,last_seen_at desc);
create index if not exists security_events_type_seen_idx on public.security_events(event_type,last_seen_at desc);
create index if not exists security_events_ip_seen_idx on public.security_events(source_ip,last_seen_at desc);
