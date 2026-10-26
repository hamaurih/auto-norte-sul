-- Metrics are now calculated in the authenticated server function with service role.
-- Remove the public SECURITY DEFINER RPC surface flagged by the Supabase linter.
drop function if exists public.get_product_name_recovery_overview(uuid);
