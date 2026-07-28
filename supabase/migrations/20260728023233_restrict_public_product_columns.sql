-- Table-level SELECT overrides column revokes. Use an explicit public projection instead.
revoke select on public.products from anon;

grant select (
  id, tenant_id, sku, name, slug, description, short_description,
  brand_id, category_id, subcategory_id,
  price_b2c, compare_at_price, sale_price_b2c, sale_starts_at, sale_ends_at,
  stock, min_stock, hide_when_out_of_stock,
  active, featured, is_new, is_bestseller, is_offer, sales_count,
  weight_kg, manufacturer_code, created_at, updated_at
) on public.products to anon;

-- Explicit invariants: wholesale/internal/integration fields stay private.
revoke select (price_b2b, internal_code, bling_id) on public.products from anon;
