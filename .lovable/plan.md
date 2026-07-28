# Plano de Evolução — Norte Sul Hub

## Auditoria (o que JÁ existe)

**Tabelas Supabase (28):** products (29 col, 4708 registros — 3542 ativos, 4708 com bling_id, 540 com imagens), product_images, product_applications, brands (10), categories (9), profiles, user_roles, orders (0), order_items, sales_orders, sales_reps, sales_rep_customers, b2b_registrations, coupons, coupon_usages, promotions, banners, bling_config, bling_sync_logs, integrations, integration_logs, integration_settings, ai_aes_config, ai_chat_sessions, ai_chat_messages, ai_knowledge_base, ai_product_embeddings, ai_tool_logs.

**Rotas admin existentes:** produtos, categorias, marcas, clientes, vendedores, pedidos, cadastros-b2b, cupons, promoções, banners, bling, ecossistema, ia-aes-business, configurações.

**MCP (6 tools):** search_products, get_product, check_stock, find_by_vehicle, list_categories, list_brands.

**Funções lib:** products, banners, bling, integrations, sales-reps, taxonomy, queries, cart-store.

**O que FALTA:** filiais/depósitos, estoque por filial, movimentações, transferências, orçamentos, auditoria operacional consolidada, busca por marca (JBL/Pioneer/Moura), diagnóstico Bling×Site.

---

## Regras invioláveis
- Zero DROP, zero reset. Só CREATE/ALTER aditivos.
- Pagamento fica como está (checkout atual = orçamento efetivamente).
- Rotas e tabelas atuais permanecem. Estoque `products.stock` continua sendo a fonte durante migração; multi-filial é aditivo.
- MCP e Bling seguem funcionando; melhorias in-place.

---

## Fases

### Fase 1 — Auditoria Operacional
- Nova rota `admin.auditoria.tsx` + `src/lib/audit.functions.ts` (serverFn `getCatalogAudit`, `getBlingAudit`, `getAiAudit`).
- Cards: produtos sem imagem/categoria/marca/SKU/preço/estoque/aplicação; com/sem Bling ID; última sync; erros recentes; tools MCP; buscas IA (usa `ai_tool_logs`); marcas/produtos mais buscados; buscas sem resultado.
- Link no menu admin.

### Fase 2 — Busca comercial inteligente
- Melhorar `search_products` (MCP) e `fetchCatalog`/`fetchSearchSuggestions`:
  - Detectar marca: se `query` casar com `brands.name` ou `brands.slug`, retornar todos os produtos daquela marca + `matchedBrand`.
  - Ampliar OR para incluir `brand.name` via join.
  - Aceitar param opcional `brand` no MCP.
- Autocomplete do header: sugerir marcas + produtos.
- Preservar filtros/ordenação atuais.

### Fase 3 — Multi-filial e estoque (aditivo)
Migração cria:
- `branches` (filial: nome, código, cidade, ativa, principal)
- `warehouses` (depósito: branch_id, nome, código)
- `product_stock` (product_id, warehouse_id, on_hand, reserved, min_stock, UNIQUE)
- `stock_movements` (product_id, warehouse_id, tipo IN/OUT/ADJUST/TRANSFER, qty, ref, user_id, notes)
- `stock_transfers` + `stock_transfer_items` (origem→destino, status)
- View `v_product_stock_available` (soma on_hand-reserved por produto) usada como fallback quando existir; senão cai em `products.stock`.
- Filial "Matriz" seed via migração para compatibilidade.
- Novas rotas admin: `admin.filiais`, `admin.estoque`, `admin.estoque.movimentacoes`, `admin.estoque.transferencias`.
- RLS + GRANTs completos.

### Fase 4 — IA/MCP melhorada
- `search_products`: adiciona `brand?` param, detecção de marca, retorna `image_url` (imagem primária) e estoque disponível consolidado.
- `check_stock`: retorna `available_total` e, se houver `product_stock`, breakdown por filial.
- `find_by_vehicle`: melhorar mensagem quando não houver aplicação.
- Atualizar `admin.ia-aes-business.tsx` com descrição/exemplos.
- Regenerar manifest MCP.

### Fase 5 — Orçamentos
Migração aditiva:
- `quotes` (numero, cliente_id, vendedor_id, branch_id, origem enum[whatsapp,ia,site,vendedor,balcao,b2b], status enum[rascunho,enviado,em_negociacao,aprovado,recusado,convertido], total, obs_interna, valid_until)
- `quote_items` (quote_id, product_id, sku, name, qty, unit_price, discount, total)
- Rota `admin.orcamentos.index` + `admin.orcamentos.$id`.
- ServerFns `quoteUpsert`, `quoteList`, `quoteConvertToOrder` (stub: cria order sem pagamento).
- Ligação MCP: nova tool `create_quote_draft` (opcional — só se couber sem quebrar).

### Fase 6 — Bling diagnóstico
- Aditivo em `bling.functions.ts`: `getBlingDiagnostic` (contadores + divergências preço/estoque via join local↔bling snapshot).
- Aba "Diagnóstico" na página Bling existente. Sem alterar sync atual.

### Fase 7 — Reorganização do menu admin
- Ajustar `admin.tsx` (sidebar) agrupando: Catálogo (produtos/categorias/marcas), Estoque (filiais/estoque/mov/transf), Comercial (orçamentos/pedidos/clientes/vendedores/B2B), Marketing (banners/cupons/promoções), Integrações (Bling/IA/ecossistema), Sistema (auditoria/config). Sem remover rotas.

---

## Ordem de execução (uma fase por vez, com verificação)
1. Migração Fase 3 (filiais/estoque) + seed Matriz.
2. Migração Fase 5 (orçamentos).
3. Fase 1 (auditoria) — usa dados já disponíveis.
4. Fase 2 (busca por marca).
5. Fase 4 (MCP melhorado + manifest).
6. Fase 6 (diagnóstico Bling).
7. Fase 7 (menu).

Após cada fase: build + spot-check das rotas críticas (catálogo, busca, admin, MCP).

## Detalhes técnicos
- Todas as migrações seguem: CREATE TABLE → GRANT authenticated + service_role → ENABLE RLS → POLICIES (staff=admin/gerente full, vendedor read/write no que lhe pertence).
- Nenhuma FK para `auth.users` fora do padrão já usado (`profiles.id`).
- Views ficam sem RLS mas com GRANT SELECT restrito.
- Novos serverFns usam `requireSupabaseAuth` + checagem `has_role`/user_roles como já usado em `products.functions.ts`.
- MCP tools continuam com publishable key (leitura pública onde já é hoje).

## O que NÃO será feito
- Pagamento (Pix/cartão/boleto).
- Remoção de Bling, MCP, tabelas, rotas, dados.
- Alteração de client.ts, types.ts, auth-middleware, __root.tsx (exceto necessário).
- Refatoração cosmética sem pedido.
