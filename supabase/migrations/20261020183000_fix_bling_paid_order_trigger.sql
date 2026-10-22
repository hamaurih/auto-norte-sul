-- Compatibility fix: storefront order states use 'paid'/'cancelled', not Portuguese.
-- Idempotent sync job uniqueness remains (tenant_id, order_id, event_type).
CREATE OR REPLACE FUNCTION private.enqueue_bling_order_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $fn$
DECLARE v_event text;
BEGIN
  IF new.user_id IS NULL OR new.idempotency_key IS NULL OR new.deleted_at IS NOT NULL THEN
    RETURN new;
  END IF;
  IF tg_op='INSERT' THEN
    v_event:='created';
  ELSIF old.status IS DISTINCT FROM new.status THEN
    IF new.status::text IN ('paid','pago') THEN v_event:='paid';
    ELSIF new.status::text IN ('cancelled','cancelado') THEN v_event:='cancelled';
    ELSE RETURN new;
    END IF;
  ELSE
    RETURN new;
  END IF;
  INSERT INTO public.bling_order_sync_jobs (tenant_id,order_id,event_type,status,scheduled_at)
  VALUES (new.tenant_id,new.id,v_event,'queued',now())
  ON CONFLICT (tenant_id,order_id,event_type) DO UPDATE
  SET status=CASE WHEN public.bling_order_sync_jobs.status='done' THEN 'done' ELSE 'queued' END,
      scheduled_at=CASE WHEN public.bling_order_sync_jobs.status='done' THEN public.bling_order_sync_jobs.scheduled_at ELSE now() END,
      last_error=CASE WHEN public.bling_order_sync_jobs.status='done' THEN public.bling_order_sync_jobs.last_error ELSE NULL END,
      updated_at=now();
  IF v_event='created' THEN
    UPDATE public.orders SET bling_sync_status='queued',bling_sync_error=NULL WHERE id=new.id;
  ELSIF v_event='paid' THEN
    UPDATE public.orders SET bling_sync_status='fiscal_pending',bling_sync_error=NULL WHERE id=new.id;
  ELSIF v_event='cancelled' THEN
    UPDATE public.orders SET bling_sync_status='queued',bling_sync_error=NULL WHERE id=new.id;
  END IF;
  RETURN new;
END;
$fn$;
