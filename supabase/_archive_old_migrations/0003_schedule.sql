-- Schedules the close-day edge function to run daily at 23:55 UTC.
-- Requires the pg_cron and pg_net extensions (enabled by default on Supabase).
--
-- Replace <PROJECT_REF> and <ANON_OR_SERVICE_KEY> after deploying the function:
--   supabase functions deploy close-day
--
-- This can also be configured from the Supabase dashboard under
-- Database -> Cron Jobs, which avoids hardcoding the URL/key in SQL.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'close-day-daily',
  '55 23 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/close-day',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  );
  $$
);
