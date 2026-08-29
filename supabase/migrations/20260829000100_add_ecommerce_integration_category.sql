-- Must run separately because PostgreSQL cannot use a newly added enum value
-- in the same transaction that adds it.
ALTER TYPE public.integration_category ADD VALUE IF NOT EXISTS 'ecommerce';
