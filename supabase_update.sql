-- Add new columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS account_status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS password_created boolean DEFAULT false;

-- Update the handle_new_user trigger to include these fields for employees, but active for HR (or we can just let defaults apply and update them in logic, but let's set them explicitly if they aren't provided)
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (
    id, 
    full_name, 
    email, 
    role, 
    phone, 
    department, 
    designation,
    account_status,
    password_created
  )
  VALUES (
    new.id, 
    coalesce(new.raw_user_meta_data->>'full_name', ''), 
    new.email, 
    coalesce((new.raw_user_meta_data->>'role')::public.app_role, 'employee'::public.app_role),
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'department',
    new.raw_user_meta_data->>'designation',
    coalesce(new.raw_user_meta_data->>'account_status', 'pending'),
    coalesce((new.raw_user_meta_data->>'password_created')::boolean, false)
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
