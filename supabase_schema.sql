-- Create custom types for roles
create type public.app_role as enum ('hr', 'employee');
create type public.leave_status as enum ('pending', 'approved', 'rejected');
create type public.attendance_status as enum ('present', 'absent', 'half', 'late', 'leave', 'pending', 'off');

-- PROFILES
create table public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  full_name text not null,
  email text not null,
  role public.app_role not null default 'employee'::public.app_role,
  phone text,
  department text,
  designation text,
  profile_image text,
  account_status text default 'pending',
  password_created boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- EMPLOYEES
create table public.employees (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  employee_id text unique not null,
  full_name text not null,
  email text not null,
  phone text,
  department text,
  designation text,
  joining_date date,
  gender text,
  address text,
  status text default 'active',
  profile_image text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ATTENDANCE
create table public.attendance (
  id uuid default gen_random_uuid() primary key,
  employee_id uuid references public.employees(id) on delete cascade not null,
  check_in timestamp with time zone,
  check_out timestamp with time zone,
  date date not null,
  status public.attendance_status not null default 'pending',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique (employee_id, date)
);

-- LEAVES
create table public.leaves (
  id uuid default gen_random_uuid() primary key,
  employee_id uuid references public.employees(id) on delete cascade not null,
  leave_type text not null,
  start_date date not null,
  end_date date not null,
  reason text,
  status public.leave_status default 'pending'::public.leave_status,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ANNOUNCEMENTS
create table public.announcements (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  description text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Row Level Security (RLS)

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.attendance enable row level security;
alter table public.leaves enable row level security;
alter table public.announcements enable row level security;

-- PROFILES RLS
-- HR can view all profiles, users can view their own
create policy "Users can view their own profile" on public.profiles
  for select using ( auth.uid() = id );
create policy "HR can view all profiles" on public.profiles
  for select using ( (select role from public.profiles where id = auth.uid()) = 'hr' );

-- Users can update their own profile
create policy "Users can update their own profile" on public.profiles
  for update using ( auth.uid() = id );
-- Service role can insert profile during registration (trigger will handle this or app code using service key, 
-- but if inserting via client, we might need a policy or we can just rely on auth triggers)
create policy "Allow insert profile on register" on public.profiles
  for insert with check ( auth.uid() = id );

-- EMPLOYEES RLS
-- Employees can view their own employee record
create policy "Users can view their own employee record" on public.employees
  for select using ( user_id = auth.uid() );
-- HR can do everything on employees
create policy "HR can manage all employees" on public.employees
  for all using ( (select role from public.profiles where id = auth.uid()) = 'hr' );
  
-- ATTENDANCE RLS
-- Employees can view their own attendance
create policy "Users can view their own attendance" on public.attendance
  for select using ( employee_id in (select id from public.employees where user_id = auth.uid()) );
-- Employees can insert/update their own attendance (check in / out)
create policy "Users can insert their own attendance" on public.attendance
  for insert with check ( employee_id in (select id from public.employees where user_id = auth.uid()) );
create policy "Users can update their own attendance" on public.attendance
  for update using ( employee_id in (select id from public.employees where user_id = auth.uid()) );
-- HR can do everything
create policy "HR can manage all attendance" on public.attendance
  for all using ( (select role from public.profiles where id = auth.uid()) = 'hr' );

-- LEAVES RLS
-- Employees can view, insert, update their own leaves
create policy "Users can view their own leaves" on public.leaves
  for select using ( employee_id in (select id from public.employees where user_id = auth.uid()) );
create policy "Users can insert their own leaves" on public.leaves
  for insert with check ( employee_id in (select id from public.employees where user_id = auth.uid()) );
-- Only pending leaves can be updated by employee usually, but let's just let them update for now
create policy "Users can update their own leaves" on public.leaves
  for update using ( employee_id in (select id from public.employees where user_id = auth.uid()) );
create policy "Users can delete their own leaves" on public.leaves
  for delete using ( employee_id in (select id from public.employees where user_id = auth.uid()) );
-- HR can manage all leaves
create policy "HR can manage all leaves" on public.leaves
  for all using ( (select role from public.profiles where id = auth.uid()) = 'hr' );

-- ANNOUNCEMENTS RLS
-- Everyone can read announcements
create policy "Anyone can read announcements" on public.announcements
  for select using ( true );
-- Only HR can insert, update, delete
create policy "HR can manage announcements" on public.announcements
  for all using ( (select role from public.profiles where id = auth.uid()) = 'hr' );


-- Functions / Triggers
-- Automatically create profile on user sign up
create or replace function public.handle_new_user() 
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, role, phone, department, designation, account_status, password_created)
  values (
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
  return new;
end;
$$ language plpgsql security definer;

-- Trigger the function every time a user is created
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Trigger to automatically create employee record when a profile is created
create or replace function public.handle_new_profile()
returns trigger as $$
declare
  emp_count int;
  emp_id text;
begin
  select count(*) into emp_count from public.employees;
  emp_id := 'EMP-' || lpad((emp_count + 1)::text, 4, '0');
  
  insert into public.employees (user_id, employee_id, full_name, email, phone, department, designation, joining_date, status)
  values (
    new.id,
    emp_id,
    new.full_name,
    new.email,
    new.phone,
    new.department,
    new.designation,
    CURRENT_DATE,
    'active'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_public_profile_created
  after insert on public.profiles
  for each row execute procedure public.handle_new_profile();
