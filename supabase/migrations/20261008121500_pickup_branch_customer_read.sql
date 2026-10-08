drop policy if exists branches_customer_pickup_read on public.branches;

create policy branches_customer_pickup_read
on public.branches
for select
to authenticated
using (
  active
  and available_for_pickup
  and exists (
    select 1
    from public.orders customer_order
    where customer_order.pickup_branch_id = branches.id
      and customer_order.user_id = (select auth.uid())
  )
);