# Reproducible Supabase branch bootstrap blocker — 2026-10-19

## Verified in isolated branch

Branch ref: `xivknccsjmeluepwoxum` (no production data copied).

- Branch status: `MIGRATIONS_FAILED`.
- 111 migrations applied. Last version: `20260904230219`.
- First failing version: `20260904230343_p2_prepare_mercado_pago_provider`.
- The migration inserts a payment provider with hard-coded tenant ID `87fee723-b111-411e-827e-ea6e67fd29ae`.
- On the clean branch, this tenant ID does not exist (query returned 0).
- PostgreSQL repro: `SQLSTATE 23503`, constraint `payment_providers_tenant_id_fkey`, insert denied.
- Zero modifications to production tables or the production migration history.

## Repair design

The migration is an **environment-specific data seed**. A clean database may have no production tenant. A proper bootstrap migration should not insert a provider tied to an arbitrary production UUID. Instead:

1. Create provider defaults only when an intended tenant exists (e.g. `INSERT ... SELECT id FROM tenants WHERE slug = 'norte-sul-real' ...`), otherwise skip without error.
2. Separate mandatory schema changes from optional seed data. Make seed repeatable with `ON CONFLICT`.
3. Ensure every *subsequent* seed migration has the same clean-branch property.
4. Apply corrected history to an isolated replay first; test the entire 202-migration chain.
5. Do **not** rewrite `supabase_migrations.schema_migrations` in production without full snapshot, SQL hash review and a separately approved maintenance plan. An append-only repair after an already-failing seed cannot make a clean replay reach that repair.

### Non-mutating diagnostic SQL

```sql
SELECT EXISTS (
 SELECT 1 FROM public.tenants
 WHERE id='87fee723-b111-411e-827e-ea6e67fd29ae'::uuid
) AS seed_target_exists;
```

Expected in clean branch: `false`.

## Acceptance

A newly provisioned Supabase branch must apply **all** 202 baseline migrations, show `ACTIVE_HEALTHY`, and pass RLS/functional smoke tests. Until then, this issue is **reproduced and diagnosed, NOT fixed**.
