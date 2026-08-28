-- Fix the stale profile trigger left by the legacy public.has_role helper.
-- The security migration moved role helpers to private.* and removed public.has_role.

create or replace function public.prevent_profile_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if private.is_admin(auth.uid()) or private.is_staff(auth.uid()) then
    return new;
  end if;

  if new.customer_group is distinct from old.customer_group then
    raise exception 'Not allowed to change customer_group';
  end if;

  if new.b2b_status is distinct from old.b2b_status then
    raise exception 'Not allowed to change b2b_status';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_prevent_privilege_escalation on public.profiles;
create trigger profiles_prevent_privilege_escalation
  before update on public.profiles
  for each row
  execute function public.prevent_profile_privilege_escalation();
