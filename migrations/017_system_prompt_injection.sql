alter table public.custom_providers
  add column system_prompt text,
  add column system_prompt_enabled boolean not null default false,
  add constraint custom_providers_system_prompt_length check (system_prompt is null or length(system_prompt) <= 16000);

alter table public.custom_provider_models
  add column system_prompt text,
  add column system_prompt_enabled boolean not null default false,
  add constraint custom_provider_models_system_prompt_length check (system_prompt is null or length(system_prompt) <= 16000);
