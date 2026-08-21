alter table public.custom_provider_models add column public_name text;

update public.custom_provider_models m
set public_name = lower(trim(both '-' from regexp_replace(
  regexp_replace(substring(m.public_model_id from position('/' in m.public_model_id) + 1), '[^a-zA-Z0-9._-]+', '-', 'g'),
  '-+', '-', 'g'
)));

update public.custom_provider_models
set public_name = 'model-' || left(replace(id::text, '-', ''), 8)
where public_name is null or public_name = '';

alter table public.custom_provider_models alter column public_name set not null;
alter table public.custom_provider_models add constraint custom_provider_models_public_name_format
  check (public_name ~ '^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$');
create unique index custom_provider_models_provider_public_name_uidx
  on public.custom_provider_models(provider_id, lower(public_name));
