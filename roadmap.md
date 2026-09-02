# Roadmap — Enriquecimento automático (piloto automático)

## Estado final — OPERACIONAL

### Concluído
- [x] Orquestrador server-side: lease por tenant → enqueue idempotente → claim atômico → processamento em fonte oficial → cópia para Storage → autoaprovação conservadora → auditoria.
- [x] Endpoint interno `/api/public/cron/enrichment` protegido por bearer secreto. Aceita `CRON_SECRET` da Vercel como opção futura e, atualmente, valida o token interno armazenado no Supabase Vault por RPC service-role-only.
- [x] Scheduler ativo em produção usando `pg_cron` + `pg_net` + Supabase Vault, a cada 10 minutos. Nenhum segredo fica no Git, frontend ou `vercel.json`.
- [x] Migration principal do autopilot criada, versionada e aplicada no Supabase de produção.
- [x] Migration de hardening do claim criada e aplicada: jobs sem produto ativo, marca, código ou fonte oficial não chegam ao crawler; ficam encerrados com motivo auditável e podem ser reenfileirados imediatamente quando o pré-requisito for corrigido.
- [x] Migration do scheduler Vault/pg_cron criada, versionada e aplicada.
- [x] `product_enrichment_runs` criada com RLS e lease de execução por tenant.
- [x] `approval_mode`, `auto_approved` e `review_reason` adicionados para distinguir aprovação automática, manual e exceções.
- [x] RPC `enqueue_product_enrichment_auto`: somente produto ativo, com marca + manufacturer_code + fonte oficial ativa, sem job ativo duplicado e com cooldown somente para falhas técnicas.
- [x] RPC `claim_product_enrichment_jobs`: `FOR UPDATE SKIP LOCKED`, recuperação de jobs presos, controle de tentativas e guard de pré-requisitos oficiais.
- [x] RPC `auto_approve_product_enrichment_candidate`: fonte oficial/whitelist, confiança >= 98, código exato normalizado, GTIN válido e sem conflito, imagens próprias antes da promoção e aplicações selecionadas com confiança >= 95 e dados válidos.
- [x] Motor `process-manufacturer-enrichment` com modo worker seguro por service-role, lote pequeno, scan conservador, retry/backoff e preservação do modo humano.
- [x] `copy-product-enrichment-image` com modo worker seguro, validação SSRF, MIME + magic bytes e Storage `product-images`.
- [x] Edge Functions publicadas no Supabase: `process-manufacturer-enrichment` v8 e `copy-product-enrichment-image` v4.
- [x] Painel de enriquecimento atualizado com métricas: fila, processando, revisão, autoaprovados, aprovados manualmente e falhas; origem, confiança, imagens/aplicações e motivo de revisão.
- [x] Painel considera o scheduler ativo quando há ciclo recente (até 30 minutos), independente de `CRON_SECRET` da Vercel.
- [x] Catálogo de fabricantes documentado como whitelist que alimenta o robô automático.
- [x] Duração de função Vercel configurada para até 300s no preset Nitro/Vercel.
- [x] `vercel.json` não mantém cron público sem autenticação; o scheduler operacional está no Supabase.
- [x] Teste SQL versionado em `supabase/tests/product_enrichment_autopilot.sql`.
- [x] Teste transacional de gates executado com rollback: `AUTOPILOT_TESTS_OK`.
- [x] Teste de lease/claim/attempts executado com rollback: `WORKER_GUARD_LOCK_TESTS_OK`.
- [x] Teste do enqueue após o hardening: `ENQUEUE_GUARD_TEST_OK`.
- [x] Scheduler disparado manualmente via `private.trigger_enrichment_autopilot()` e validado por `pg_net`: HTTP 200, sem timeout.
- [x] Primeiro ciclo real concluído: 25 enfileirados, 2 processados, 1 autoaprovado, 1 reagendado, 4 imagens copiadas, 0 falhas no tenant real; tenant demo sem alterações.
- [x] Deploys de produção da Vercel ficaram `READY` durante a implementação.

### Configuração externa necessária
Nenhuma para o scheduler atual. `CRON_SECRET` permanece opcional apenas se, no futuro, for desejado voltar a usar o scheduler nativo da Vercel.
