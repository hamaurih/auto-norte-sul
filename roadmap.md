# Roadmap — Enriquecimento automático (piloto automático)

## Concluído nesta rodada
- [x] `src/lib/product-enrichment-autopilot.server.ts` — orquestrador do worker (lease → enqueue → claim → motor → cópia de imagens → autoaprovação → métricas).
- [x] `src/routes/api/public/cron.enrichment.ts` — endpoint de cron protegido por `CRON_SECRET` (fail closed, comparação em tempo constante).
- [x] `vercel.json` — Vercel Cron a cada 10 minutos em `/api/public/cron/enrichment`.
- [x] `supabase/config.toml` — `verify_jwt = false` nas duas functions do motor (auth continua dentro delas; necessário para o modo worker com `sb_secret_`).

## Pendente (próxima rodada — em ordem)
- [ ] Migration `supabase/migrations/2026090217xxxx_enrichment_autopilot.sql`:
      trigger_source `'auto'`; `jobs.approval_mode`; `candidates.auto_approved` + `review_reason`;
      tabela `product_enrichment_runs` (RLS select p/ owner|admin|manager|stock, grants, índice único parcial `status='running'` por tenant);
      helpers `private.normalize_product_code` + `private.valid_gtin` (mod-10);
      `private.promote_enrichment_candidate(candidate, reviewer, auto)` fatorada a partir da versão MAIS RECENTE de `approve_product_enrichment_candidate`
      (ler antes em `supabase/migrations/20260831143000_enrichment_gallery_fitments.sql` e `20260831144500_enrichment_item_selection.sql` — NÃO usar a versão antiga de `supabase/manual/20260819...`);
      RPCs service_role-only: `enqueue_product_enrichment_auto` (elegível = ativo + marca + manufacturer_code + fonte ativa da marca; falta imagem/aplicação/GTIN/descrição; cooldown 14d p/ failed; `on conflict ... where status in (queued,processing,review) do nothing`),
      `claim_product_enrichment_jobs` (recupera presos >20min c/ backoff, `for update skip locked`, attempts+1),
      `begin_product_enrichment_run`/`finish_product_enrichment_run` (lease c/ expiração 15min),
      `auto_approve_product_enrichment_candidate(p_candidate_id, p_dry_run)` — gates: source_type=manufacturer, confiança>=98, domínio em `manufacturer_catalog_sources` ativa do mesmo tenant+marca, `specifications->>'matched_code'` normalizado == manufacturer_code do produto, código sugerido igual ou nulo, GTIN válido e sem divergência (divergente → review), imagens selecionadas todas com `storage_url`, aplicações selecionadas confiança>=95 e dados completos; nunca altera preço/estoque; grava `review_reason` quando inelegível.
- [ ] `supabase/functions/process-manufacturer-enrichment/index.ts` — modo worker: bearer == SERVICE_ROLE_KEY (comparar via SHA-256), exige `jobIds` (já em `processing`, sem re-update de attempts), retry/backoff na falha (attempts<3 → `queued` c/ scheduled_at +30min/+3h, senão `failed`), scan budget reduzido (~18 páginas) no modo worker; modo humano intacto.
- [ ] `supabase/functions/copy-product-enrichment-image/index.ts` — aceitar modo worker (mesmo bearer), pulando getUser/membership; resto intacto.
- [ ] `src/lib/product-enrichment.functions.ts` — `getEnrichmentOverview` (counts head:true por status + approval_mode, último run, `automationConfigured = Boolean(process.env['CRON_SECRET'])`, try/catch se a tabela runs ainda não existir); acrescentar `approval_mode` / `auto_approved,review_reason` no select de `listProductEnrichmentJobs`.
- [ ] `src/routes/_authenticated/admin.enriquecimento-produtos.tsx` — cards de métricas (Na fila, Processando, Em revisão, Autoaprovados, Aprovados manualmente, Falhas), linha "Automação ativa · último ciclo…", frase explicando que o robô roda em background, botões renomeados p/ contingência ("Processar agora"/"Enfileirar agora"), badge "Autoaprovado" (job.approval_mode==='auto' / c.auto_approved) e exibição de `review_reason`; filtro "processing".
- [ ] `src/routes/_authenticated/admin.catalogo-fabricantes.tsx` (linha 43) — texto: fontes/regras alimentam o robô automático; só domínios cadastrados geram autoaprovação.
- [ ] `vite.config.ts` — no bloco nitro, quando `isVercel`: `vercel: { functions: { maxDuration: 300 } }`.
- [ ] `.env.example` — adicionar `CRON_SECRET=""` (comentário: usado pelo Vercel Cron).
- [ ] `supabase/tests/product_enrichment_autopilot.sql` — begin/rollback no padrão dos testes existentes: enqueue idempotente (2ª chamada = 0), GTIN divergente não sobrescreve, imagem sem storage_url não promove, produto sem marca/código não enfileira, happy path marca `approval_mode='auto'`.
- [ ] Rodar `bunx tsgo --noEmit` e `bun run build` ao final.
- [ ] Resumo final: arquitetura, regra exata de autoaprovação, frequência (10 min), proteção (CRON_SECRET + service-role interno), arquivos/migrations, config externa (definir `CRON_SECRET` na Vercel, aplicar migration, redeploy das duas edge functions com o config.toml novo).
