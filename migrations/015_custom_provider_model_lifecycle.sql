alter table public.custom_provider_models
  add column if not exists stale_at timestamptz,
  add column if not exists disabled_reason text;

create index if not exists custom_models_stale_idx
  on public.custom_provider_models(provider_id, stale_at)
  where stale_at is not null;
