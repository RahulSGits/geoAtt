-- Enable pgcrypto extension (required for crypt password hashing)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  hr_uid UUID;
  emp_uid UUID;
BEGIN
  -- ==========================================
  -- 1. Setup HR Demo Account (hr@demo.com)
  -- ==========================================
  SELECT id INTO hr_uid FROM auth.users WHERE email = 'hr@demo.com';

  IF hr_uid IS NULL THEN
    hr_uid := gen_random_uuid();
    
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      is_super_admin
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      hr_uid,
      'authenticated',
      'authenticated',
      'hr@demo.com',
      crypt('demo1234', gen_salt('bf', 10)),
      now(),
      '{"provider": "email", "providers": ["email"]}',
      '{"full_name": "HR Demo User", "role": "hr", "account_status": "active", "password_created": true}',
      now(),
      now(),
      false
    );
  ELSE
    UPDATE auth.users
    SET encrypted_password = crypt('demo1234', gen_salt('bf', 10)),
        email_confirmed_at = now(),
        raw_user_meta_data = '{"full_name": "HR Demo User", "role": "hr", "account_status": "active", "password_created": true}',
        updated_at = now()
    WHERE id = hr_uid;
  END IF;

  -- Ensure public.profiles is activated for HR
  UPDATE public.profiles
  SET account_status = 'active',
      password_created = true,
      role = 'hr'
  WHERE id = hr_uid;


  -- ==========================================
  -- 2. Setup Employee Demo Account (employee@demo.com)
  -- ==========================================
  SELECT id INTO emp_uid FROM auth.users WHERE email = 'employee@demo.com';

  IF emp_uid IS NULL THEN
    emp_uid := gen_random_uuid();
    
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      is_super_admin
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      emp_uid,
      'authenticated',
      'authenticated',
      'employee@demo.com',
      crypt('demo1234', gen_salt('bf', 10)),
      now(),
      '{"provider": "email", "providers": ["email"]}',
      '{"full_name": "Employee Demo User", "role": "employee", "account_status": "active", "password_created": true}',
      now(),
      now(),
      false
    );
  ELSE
    UPDATE auth.users
    SET encrypted_password = crypt('demo1234', gen_salt('bf', 10)),
        email_confirmed_at = now(),
        raw_user_meta_data = '{"full_name": "Employee Demo User", "role": "employee", "account_status": "active", "password_created": true}',
        updated_at = now()
    WHERE id = emp_uid;
  END IF;

  -- Ensure public.profiles is activated for Employee
  UPDATE public.profiles
  SET account_status = 'active',
      password_created = true,
      role = 'employee'
  WHERE id = emp_uid;

END $$;
