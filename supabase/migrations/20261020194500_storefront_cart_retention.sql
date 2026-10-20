-- Delete pseudonymous cart sessions after 90 days, without touching orders or payments.
CREATE OR REPLACE FUNCTION private.prune_storefront_cart_sessions()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE n bigint;
BEGIN
 DELETE FROM public.storefront_cart_sessions
 WHERE updated_at < now() - interval '90 days';
 GET DIAGNOSTICS n = ROW_COUNT;
 RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION private.prune_storefront_cart_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.prune_storefront_cart_sessions() TO service_role;
DO $$
BEGIN
 IF to_regclass('cron.job') IS NOT NULL THEN
   EXECUTE $schedule$SELECT cron.schedule('prune-storefront-cart-sessions','35 3 * * *','SELECT private.prune_storefront_cart_sessions()')$schedule$;
 END IF;
END;
$$;
