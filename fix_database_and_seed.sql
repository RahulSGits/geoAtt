-- ==========================================
-- 1. Fix Infinite Recursion in RLS Policies
-- ==========================================
-- We create a security definer function to read the role bypassing RLS,
-- which prevents the infinite loop when evaluating policies.

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text AS $$
DECLARE
  my_role text;
BEGIN
  SELECT role::text INTO my_role FROM public.profiles WHERE id = auth.uid();
  RETURN my_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update profiles policy
DROP POLICY IF EXISTS "HR can view all profiles" ON public.profiles;
CREATE POLICY "HR can view all profiles" ON public.profiles
  FOR SELECT USING ( public.get_my_role() = 'hr' );

-- Update employees policy
DROP POLICY IF EXISTS "HR can manage all employees" ON public.employees;
CREATE POLICY "HR can manage all employees" ON public.employees
  FOR ALL USING ( public.get_my_role() = 'hr' );

-- Update attendance policy
DROP POLICY IF EXISTS "HR can manage all attendance" ON public.attendance;
CREATE POLICY "HR can manage all attendance" ON public.attendance
  FOR ALL USING ( public.get_my_role() = 'hr' );

-- Update leaves policy
DROP POLICY IF EXISTS "HR can manage all leaves" ON public.leaves;
CREATE POLICY "HR can manage all leaves" ON public.leaves
  FOR ALL USING ( public.get_my_role() = 'hr' );

-- Update announcements policy
DROP POLICY IF EXISTS "HR can manage announcements" ON public.announcements;
CREATE POLICY "HR can manage announcements" ON public.announcements
  FOR ALL USING ( public.get_my_role() = 'hr' );

-- ==========================================
-- 2. Setup Demo Accounts (from your seed script)
-- ==========================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  hr_uid UUID;
  emp_uid UUID;
BEGIN
  -- Setup HR Demo Account (hr@demo.com)
  SELECT id INTO hr_uid FROM auth.users WHERE email = 'hr@demo.com';

  IF hr_uid IS NULL THEN
    hr_uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_super_admin
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', hr_uid, 'authenticated', 'authenticated', 'hr@demo.com',
      crypt('demo1234', gen_salt('bf', 10)), now(), '{"provider": "email", "providers": ["email"]}',
      '{"full_name": "HR Demo User", "role": "hr", "account_status": "active", "password_created": true}',
      now(), now(), false
    );
  ELSE
    UPDATE auth.users
    SET encrypted_password = crypt('demo1234', gen_salt('bf', 10)),
        email_confirmed_at = now(),
        raw_user_meta_data = '{"full_name": "HR Demo User", "role": "hr", "account_status": "active", "password_created": true}',
        updated_at = now()
    WHERE id = hr_uid;
  END IF;

  UPDATE public.profiles
  SET account_status = 'active', password_created = true, role = 'hr'
  WHERE id = hr_uid;

  -- Setup Employee Demo Account (employee@demo.com)
  SELECT id INTO emp_uid FROM auth.users WHERE email = 'employee@demo.com';

  IF emp_uid IS NULL THEN
    emp_uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_super_admin
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', emp_uid, 'authenticated', 'authenticated', 'employee@demo.com',
      crypt('demo1234', gen_salt('bf', 10)), now(), '{"provider": "email", "providers": ["email"]}',
      '{"full_name": "Employee Demo User", "role": "employee", "account_status": "active", "password_created": true}',
      now(), now(), false
    );
  ELSE
    UPDATE auth.users
    SET encrypted_password = crypt('demo1234', gen_salt('bf', 10)),
        email_confirmed_at = now(),
        raw_user_meta_data = '{"full_name": "Employee Demo User", "role": "employee", "account_status": "active", "password_created": true}',
        updated_at = now()
    WHERE id = emp_uid;
  END IF;

  UPDATE public.profiles
  SET account_status = 'active', password_created = true, role = 'employee'
  WHERE id = emp_uid;

END $$;
