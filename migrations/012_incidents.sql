create table if not exists public.incidents (
 id uuid primary key default gen_random_uuid(), title text not null, message text not null,
 severity text not null check(severity in('minor','major','critical')), status text not null check(status in('investigating','identified','monitoring','resolved')),
 components text[] not null default '{}', created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), resolved_at timestamptz
);
create table if not exists public.incident_updates (
 id bigint generated always as identity primary key, incident_id uuid not null references public.incidents(id) on delete cascade,
 status text not null check(status in('investigating','identified','monitoring','resolved')), message text not null,
 created_by uuid references public.users(id) on delete set null, created_at timestamptz not null default now()
);
create index if not exists incidents_status_updated_idx on public.incidents(status,updated_at desc);
create index if not exists incident_updates_incident_idx on public.incident_updates(incident_id,created_at desc);
