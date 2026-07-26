-- Face enrollment: store a normalized landmark-geometry signature per employee
-- so check-in selfies can be matched 1:1 against the enrolled face on-device.
alter table public.profiles
  add column if not exists face_enrolled boolean not null default false,
  add column if not exists face_signature jsonb;

-- Record which selfie / verification a session used, for audit.
alter table public.attendance_sessions
  add column if not exists face_verified boolean not null default false;
