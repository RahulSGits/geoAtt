-- ============================================================================
-- FinAtt — step 1 of 2: add the `admin` role label.
--
-- Its own file on purpose: PostgreSQL refuses to USE a new enum label in the
-- same transaction that added it, and the Supabase SQL editor runs a script as
-- one transaction. Run this first, let it commit, then run
-- 20260731000000_role_management.sql.
-- ============================================================================

alter type public.app_role add value if not exists 'admin';
