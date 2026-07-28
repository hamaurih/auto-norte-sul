-- 1) Bling config: remove overly-broad staff SELECT.
--    Admins keep full access via the existing "Bling cfg admin only" ALL policy.
--    Non-admin staff never had a legitimate reason to read OAuth tokens/secrets.
DROP POLICY IF EXISTS bling_config_staff_read ON public.bling_config;

-- 2) Products: hide wholesale pricing and internal codes from anonymous visitors.
--    RLS is row-level only; column protection is done with column-level GRANTs.
--    Authenticated users (B2B, staff, admin) keep access.
REVOKE SELECT (price_b2b, internal_code) ON public.products FROM anon;