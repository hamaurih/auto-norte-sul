
DROP TRIGGER IF EXISTS trg_b2b_registration_after_insert ON public.b2b_registrations;
CREATE TRIGGER trg_b2b_registration_after_insert
  AFTER INSERT ON public.b2b_registrations
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_b2b_registration();
