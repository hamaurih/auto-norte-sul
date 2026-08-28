-- Public catalog reads are governed by RLS policies in
-- 20260828000004_storefront_policies_and_pix.sql.
-- Grant the table-level privilege required for anon to evaluate those policies.
GRANT SELECT ON TABLE public.products TO anon;
