# Roadmap — Enriquecimento automático (piloto automático)

## Estado final

### Concluído
- [x] Orquestrador server-side: lease por tenant → enqueue idempotente → claim atômico → processamento em fonte oficial → cópia para Storage → autoaprovação conservadora → auditoria.
- [x] Endpoint interno `/api/public/cron/enrichment` com autenticação `CRON_SECRET`, comparação em tempo constante e comportamento fail-closed.
- [x] Vercel Cron configurado em `vercel.json` para executar a cada 10 minutos.
- [x] Migration `20260902173000_enrichment_autopilot.sql` criada, versionada e aplicada no Supabase de produção.
- [x] `product_enrichment_runs` criada com RLS e lease de execução por tenant.
- [x] `approval_mode`, `auto_approved` e `review_reason` adicionados para distinguir aprovação automática, manual e exceções.
- [x] RPC `enqueue_product_enrichment_auto`: somente produto ativo, com marca + manufacturer_code + fonte oficial ativa, sem job ativo duplicado e com cooldown após falha.
- [x] RPC `claim_product_enrichment_jobs`: `FOR UPDATE SKIP LOCKED`, recuperação de jobs presos e controle de tentativas.
- [x] RPC `auto_approve_product_enrichment_candidate`: fonte oficial/whitelist, confiança >= 98, código exato normalizado, GTIN válido e sem conflito, imagens próprias antes da promoção e aplicações selecionadas com confiança >= 95 e dados válidos.
- [x] Motor `process-manufacturer-enrichment` com modo worker seguro por service-role, lote pequeno, scan conservador, retry/backoff e preservação do modo humano.
- [x] `copy-product-enrichment-image` com modo worker seguro, validação SSRF, MIME + magic bytes e Storage `product-images`.
- [x] As duas Edge Functions foram publicadas no Supabase (`process-manufacturer-enrichment` v8 e `copy-product-enrichment-image` v4), ambas com autenticação implementada dentro da função.
- [x] Painel de enriquecimento atualizado com métricas: fila, processando, revisão, autoaprovados, aprovados manualmente e falhas; origem, confiança, imagens/aplicações e motivo de revisão.
- [x] Catálogo de fabricantes documentado como whitelist que alimenta o robô automático.
- [x] Duração de função Vercel configurada para até 300s no preset Nitro/Vercel.
- [x] `.env.example` documenta `CRON_SECRET` como segredo server-side.
- [x] Teste SQL versionado em `supabase/tests/product_enrichment_autopilot.sql`.
- [x] Teste transacional executado em produção com rollback: `AUTOPILOT_TESTS_OK`.
- [x] Teste de lease/claim/attempts executado com rollback: `WORKER_LOCK_TESTS_OK`.
- [x] Último commit de testes gerou deployment de produção Vercel `READY`.

### Única configuração externa ainda necessária
- [ ] Definir `CRON_SECRET` no projeto **auto-norte-sul** da Vercel para os ambientes usados pelo cron (obrigatoriamente Production). A Vercel enviará automaticamente `Authorization: Bearer <CRON_SECRET>` nas execuções do Cron. Sem essa variável o endpoint retorna HTTP 503 por projeto de segurança e o robô não executa sozinho.

> Esta variável não deve ser gravada no GitHub, `vercel.json`, frontend ou banco. Ela deve existir somente no cofre de Environment Variables da Vercel.
