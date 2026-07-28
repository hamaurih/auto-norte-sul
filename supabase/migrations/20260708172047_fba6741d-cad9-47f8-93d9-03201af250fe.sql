
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Skip check if caller is admin or staff
  IF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff') THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_group IS DISTINCT FROM OLD.customer_group THEN
    RAISE EXCEPTION 'Not allowed to change customer_group';
  END IF;

  IF NEW.b2b_status IS DISTINCT FROM OLD.b2b_status THEN
    RAISE EXCEPTION 'Not allowed to change b2b_status';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_privilege_escalation ON public.profiles;
CREATE TRIGGER profiles_prevent_privilege_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_privilege_escalation();
