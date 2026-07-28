-- Covers the audit_events.actor_user_id foreign key and actor-based investigations.
create index audit_events_actor_user_idx
  on public.audit_events (actor_user_id, created_at desc)
  where actor_user_id is not null;
