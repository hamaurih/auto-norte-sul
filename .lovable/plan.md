# Auditoria de migração — `pleuoxzocgoajmymipqi` → `pzwjbitjersngordgcsh`

Somente inventário, bloqueios e plano. Nada foi alterado.

## Verificações feitas nesta auditoria

- Backend conectado: `pleuoxzocgoajmymipqi` (`.env`, `supabase/config.toml`, `src/lib/mcp/index.ts`).
- Lovable Cloud **não** está habilitado neste projeto: o backend é um projeto Supabase externo.
- Sondagem REST somente leitura com a chave publishable: `products`, `tenants`, `organizations`, `audit_events`, `payment_intents`, `tenant_company_profiles` respondem `42501 permission denied` — ou seja, **existem** no banco e nenhuma leitura anônima é permitida. O arquivo `src/integrations/supabase/types.ts` está desatualizado (não lista as tabelas de tenant/pagamento) e não deve ser usado como inventário de schema.

## 1. Schema (a partir das migrations do repositório)

Somatório declarado em `supabase/migrations/` (34 arquivos):

- 2 `create schema` (inclui o schema privado de funções `security definer`)
- 53 `create table`
- 3 views (2 `create or replace view`, 1 `create view`) — inclui `v_product_stock_available`
- 34 `create or replace function`
- 33 `create trigger`
- 19 `create type` (enums: `app_role`, `customer_group`, `b2b_approval_status`, ambiente de tenant, status de orçamento/pagamento etc.)
- 102 `create index`
- 230 `create policy` (RLS)
- Extensões: `pg_cron` (`create extension if not exists pg_cron`)
- 1 bucket criado por SQL: `insert into storage.buckets` em `20260728101500_create_tenant_company_profiles.sql`
- 1 job agendado: `cron.schedule(...)` em `20260728093241_complete_reservation_lifecycle.sql` (expiração de reservas)

Domínios: catálogo (products, product_images, product_applications, brands, categories, search_aliases), estoque multi-filial (branches, warehouses, product_stock, stock_movements, stock_transfers/items), comercial (orders, order_items, sales_orders, quotes, quote_items, sales_reps, coupons, promotions), identidade (profiles, user_roles), SaaS (organizations, tenants, memberships, tenant_storefronts, tenant_company_profiles, tenant_modules, tenant_invitations, audit_events), pagamentos (payment orchestration), IA/Bling (ai_*, bling_*, integrations, integration_logs).

## 2. Migrations

- 34 arquivos versionados em `supabase/migrations/`.
- 1 script fora do controle de migration: `supabase/phase-1e1/20260728140000_create_tenant_invitations.sql`.
- 1 script manual pendente: `supabase/manual/20260810191500_grant_admin_to_owner_account.sql`.
- **Não confirmado nesta auditoria:** qual conjunto exato já está aplicado em `pleu...`. É preciso ler `supabase_migrations.schema_migrations` no banco antes do cutover.

## 3. Auth

Requer exportação privilegiada (não acessível daqui): `auth.users`, `auth.identities`, `auth.mfa_*`, hashes de senha, `email_confirmed_at`, provedores. Configurações a replicar: Site URL, Redirect URLs (incluindo `/redefinir-senha`), Google OAuth (client id/secret e URIs autorizadas), confirmação de e-mail, templates de e-mail, tempo de expiração, proteção HIBP.

## 4. Storage

- Buckets referenciados pelo código: `product-images` (`src/components/admin/ProductForm.tsx`), `tenant-branding` (`src/routes/_authenticated/admin.configuracoes.tsx`).
- 1 bucket criado por migration (`tenant_company_profiles`).
- Objetos e policies de storage precisam de cópia bucket-a-bucket com credencial privilegiada; a contagem real de objetos não foi apurada.

## 5. Edge Functions e secrets

- 1 Edge Function no repositório: `supabase/functions/aes-ai-chat`.
- Secrets que ela consome: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AES_AI_API_URL`, `AES_AI_API_KEY`.
- Secrets usados pelo runtime do app (server functions): `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `SITE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `PUBLIC_TENANT_SLUG`, `TENANT_STOREFRONT_SLUG`.
- Valores de secrets não são legíveis nem serão expostos; devem ser reinseridos manualmente no destino.

## 6. Realtime, cron, webhooks, integrações

- Realtime: **nenhum uso no código** (nenhum `.channel(` / subscription). Nada a migrar salvo publicações criadas manualmente no painel.
- Cron: 1 job (`pg_cron`) — requer `pg_cron` habilitado no destino e recriação do agendamento.
- Webhook público: `src/routes/api/public/bling.callback.ts` (callback OAuth do Bling) — a URL de redirect precisa ser reconfirmada no Bling se o domínio mudar; o project ref do Supabase não aparece nessa URL.
- MCP: `.lovable/mcp/manifest.json` fixa `issuer` e `jwks_uri` em `pleu...` — precisa ser regerado.

## 7. Arquivos/variáveis que apontam para `pleu...`

- `.env` — `SUPABASE_PROJECT_ID`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, e os três equivalentes `VITE_*`.
- `supabase/config.toml` — `project_id`.
- `src/lib/mcp/index.ts:3` — URL de fallback hardcoded.
- `.lovable/mcp/manifest.json` — `issuer` e `jwks_uri`.
- `src/integrations/supabase/types.ts` — precisa ser regerado no destino.
- (Documentação em `docs/` e `supabase/manual/*` cita o ref antigo; sem efeito em runtime.)

## 8. Dados que exigem export/import

Ordem importa por causa das FKs: organizations → tenants → memberships/storefronts/company_profiles → brands/categories → products → product_images/applications → branches/warehouses → product_stock/stock_movements/transfers → profiles/user_roles → sales_reps → orders/order_items/sales_orders → quotes/quote_items → coupons/promotions/banners → bling_config/logs, integrations, ai_* (embeddings são volumosos), audit_events. Volume relevante conhecido: ~4.7k produtos e imagens associadas.

## 9. Transferência direta do projeto para a organização Pro

- Como o projeto **não** é Lovable Cloud gerenciado, ele pertence a uma organização Supabase controlada pelo proprietário — logo a transferência de projeto entre organizações pelo painel do Supabase é o caminho mais barato e evita migrar dados, Auth, storage e secrets.
- Condições a confirmar no painel (não verificáveis daqui): a mesma conta deve ser **Owner** na organização de origem e na A&S Business; o projeto não pode estar pausado; extensões e add-ons devem ser suportados no plano de destino.
- Se a transferência for possível, `pzwjbitjersngordgcsh` fica vazio e sem uso, e a única alteração no app é nenhuma (project ref não muda). Se não for possível, cai-se na migração completa (itens 1–8).

## Bloqueios (fatos)

1. Sem acesso de escrita ou administrativo ao banco nesta sessão: sem `PGHOST`/`psql`, sem `SUPABASE_SERVICE_ROLE_KEY`, e a ferramenta de migration está indisponível/desabilitada. Logo eu **não posso** exportar dados, listar usuários, buckets, objetos, cron jobs ou secrets, nem aplicar SQL no destino.
2. Sem token da Management API do Supabase: não é possível confirmar ownership, plano, extensões ou configurações de Auth de nenhum dos dois projetos por ferramenta.
3. `types.ts` desatualizado — qualquer inventário derivado dele é inválido; a fonte de verdade é o banco.
4. Não foi possível confirmar quais migrations estão aplicadas em `pleu...`.
5. Senhas de usuários só podem ser preservadas por export privilegiado de `auth.users`; qualquer caminho alternativo obriga reset de senha para todos.

## 10. Plano recomendado

### Fase A — Decisão (1 passo, sem risco)
Verificar no painel do Supabase se `pleuoxzocgoajmymipqi` pode ser transferido para A&S Business (Project Settings → General → Transfer project). Se sim, **encerrar aqui**: sem migração, sem janela, sem risco de dados. Documentar e descartar/reservar `pzwjbitjersngordgcsh`.

### Fase B — Migração completa (somente se A falhar)
1. **Levantamento autoritativo**: com a connection string do `pleu...`, coletar lista de migrations aplicadas, extensões, cron jobs, buckets + contagem de objetos, contagem de linhas por tabela, e configurações de Auth. Esse é o baseline de conferência.
2. **Backup**: `pg_dump` lógico completo (schema + dados + `auth`), export dos objetos de storage, e snapshot/PITR ativo no origem. Guardar checksums.
3. **Provisionar destino**: habilitar extensões (`pg_cron`, `pgcrypto`, `vector` se usada por `ai_product_embeddings`), aplicar schema, depois dados na ordem de FK, depois `auth.users`/`auth.identities`, depois storage, depois recriar cron e buckets/policies.
4. **Secrets e config**: reinserir todos os secrets do item 5 no destino; replicar Site URL, Redirect URLs e Google OAuth; reativar HIBP se estiver ativo hoje.
5. **App**: atualizar `.env`, `supabase/config.toml`, o fallback em `src/lib/mcp/index.ts`, regerar `types.ts` e `.lovable/mcp/manifest.json`. Rodar typecheck e build.
6. **Testes de aceite** (freeze de escrita ativo): login e-mail/senha de um usuário real, Google OAuth, recuperação de senha, `/admin` com papel admin, catálogo e busca, carrinho/checkout, estoque por filial, orçamentos, upload de imagem de produto e branding, Edge Function `aes-ai-chat`, tools MCP, callback do Bling, cron de reservas. Comparar contagem de linhas por tabela contra o baseline.
7. **Janela**: freeze de escrita de ~2–4 h (dump/restore de ~4.7k produtos, imagens e embeddings; storage domina o tempo). Melhor horário: fora do horário comercial.
8. **Rollback**: reverter `.env`/`config.toml` para `pleu...` e reabrir escrita — o origem permanece intacto e não é apagado. Critério de rollback: qualquer falha de login, divergência de contagem de linhas, ou storage/Edge Function inoperante. Origem só é desativado após 7–14 dias de operação estável no destino.

### Dependências que só o proprietário pode executar
Transferência de projeto, geração de connection string/service_role, execução do `pg_dump`/restore, inserção dos secrets, e configuração de Auth/OAuth no destino.
