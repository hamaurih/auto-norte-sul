-- Depois que o frontend passou a usar as versões v2 tenant-scoped,
-- as RPCs legadas sem tenant explícito ficam somente para service_role.

revoke all on function public.close_inventory_period(date) from public;
revoke all on function public.close_inventory_period(date) from anon;
revoke all on function public.close_inventory_period(date) from authenticated;
grant execute on function public.close_inventory_period(date) to service_role;

revoke all on function public.refresh_cost_sanitation_queue() from public;
revoke all on function public.refresh_cost_sanitation_queue() from anon;
revoke all on function public.refresh_cost_sanitation_queue() from authenticated;
grant execute on function public.refresh_cost_sanitation_queue() to service_role;

revoke all on function public.propose_manual_product_cost(uuid, numeric, text, text) from public;
revoke all on function public.propose_manual_product_cost(uuid, numeric, text, text) from anon;
revoke all on function public.propose_manual_product_cost(uuid, numeric, text, text) from authenticated;
grant execute on function public.propose_manual_product_cost(uuid, numeric, text, text) to service_role;

revoke all on function public.approve_product_cost_candidates(uuid[]) from public;
revoke all on function public.approve_product_cost_candidates(uuid[]) from anon;
revoke all on function public.approve_product_cost_candidates(uuid[]) from authenticated;
grant execute on function public.approve_product_cost_candidates(uuid[]) to service_role;
