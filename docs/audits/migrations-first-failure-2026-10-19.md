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


## Validated repair — 19 October 2026

The production migration metadata entry `20260904230343` was corrected **transactionally** to seed Mercado Pago with `INSERT ... SELECT` from the actual active `norte-sul-real` tenant, skipping the seed when this tenant is absent in a clean branch. The pre-correction SQL was preserved in `private.migration_replay_repair_backup` under that version and original MD5 `7b423002ab443854dd29167c7c61a462`. The new stored SQL MD5 is `434cf133e1f8d411ae1491dde7da568e`. **Business data, payment provider records, and ordinary production tables were not changed by this metadata repair.** This is a narrowly scoped exceptional correction to the managed migration history; retain the backup for rollback/audit.

Fresh Supabase test branch `verify-migration-replay-20261019`, ref `zkiacfksewayshlqpczf`:
- Previously first attempt stopped at **111/202** migrations with SQLSTATE 23503.
- Following the correction, **202/202** migrations applied.
- New branch: public base tables without RLS = **0**.
- New branch: public `SECURITY DEFINER` functions executable by `anon` or `authenticated` = **0**.
- GitHub PR checks: API Security, Phase 0 Security, Phase 1 ERP Core, Quality = **all passing** at commit `295616cabb771ace1e469f4fe847c050089db0cf`.

**Status note:** branch provisioning reported `FUNCTIONS_DEPLOYED` with preview project `ACTIVE_HEALTHY` at the time the 202/202 replay completed. The legacy default branch's metadata continued to display `MIGRATIONS_FAILED` from its previous history; this field does not mean the repaired replay failed. Do not manually overwrite provider branch state. Full end-user role testing, backup restore verification and manual smoke testing are tracked independently.
