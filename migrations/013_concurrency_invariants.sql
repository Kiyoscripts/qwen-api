-- Serialize all mutations that could remove an enabled administrator. The
-- transaction-level advisory lock closes races across bulk and single routes.
create or replace function public.preserve_enabled_admin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.role = 'admin' and not old.disabled
     and (tg_op = 'DELETE' or new.role <> 'admin' or new.disabled) then
    perform pg_advisory_xact_lock(834276120);
    if (select count(*) from public.users where role = 'admin' and not disabled) <= 1 then
      raise exception 'The final enabled administrator must be preserved.' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists users_preserve_enabled_admin on public.users;
create trigger users_preserve_enabled_admin
before update of role, disabled or delete on public.users
for each row execute function public.preserve_enabled_admin();

revoke all on function public.preserve_enabled_admin() from public;
