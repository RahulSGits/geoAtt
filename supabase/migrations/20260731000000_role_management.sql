-- ============================================================================
-- FinAtt — step 2 of 2: admin tier + role management.
--
-- Run 20260730000000_admin_role.sql FIRST and let it commit. Safe to re-run.
--
-- Admin is the top tier: it can edit anything and is the ONLY role that may
-- assign a member's portal. HR keeps workforce management but cannot change
-- roles.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Role helpers. is_hr() already treats admin as a superset (see login
--    tracking migration); (re)assert it here so admin inherits HR's reach.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((select role::text = 'admin' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_hr()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((select role::text in ('hr','admin') from public.profiles where id = auth.uid()), false);
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Assign a member's role. Admin-only, and refuses to demote the last admin
--    so the top tier can never be emptied and lock everyone out.
-- ---------------------------------------------------------------------------
create or replace function public.set_member_role(target uuid, new_role text)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  admin_count int;
  current_role text;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can change roles.';
  end if;
  if new_role not in ('admin','hr','employee') then
    raise exception 'Invalid role: %', new_role;
  end if;

  select role::text into current_role from public.profiles where id = target;
  if current_role is null then
    raise exception 'That member no longer exists.';
  end if;

  -- Block demoting the final admin.
  if current_role = 'admin' and new_role <> 'admin' then
    select count(*) into admin_count from public.profiles where role = 'admin'::public.app_role;
    if admin_count <= 1 then
      raise exception 'Cannot change the last administrator. Promote someone else to admin first.';
    end if;
  end if;

  update public.profiles set role = new_role::public.app_role where id = target;
  return new_role;
end;
$$;

revoke all on function public.set_member_role(uuid, text) from public;
grant execute on function public.set_member_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Admin may read and edit every profile (for the members list).
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles
  for select using (public.is_admin());

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. Promote your first admin. Edit the email, or run the UPDATE yourself.
-- ---------------------------------------------------------------------------
update public.profiles set role = 'admin' where email = 'admin@demo.com';

select role::text as role, count(*) from public.profiles group by 1 order by 1;
