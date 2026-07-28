# Fundação SaaS do Auto Deal Hub

Status: fase 1A, aditiva e ainda não aplicada em produção.

## Objetivo

Criar a fronteira de isolamento necessária para transformar o sistema atual em SaaS multiempresa sem interromper a operação da Norte Sul.

## Modelo

- `organizations`: conta comercial do cliente SaaS.
- `tenants`: fronteira rígida de dados, separando `production`, `demo` e `sandbox`.
- `organization_memberships`: acesso administrativo, cobrança e auditoria.
- `tenant_memberships`: papéis operacionais da empresa.
- `tenant_modules`: módulos habilitados por ambiente.
- `audit_events`: trilha imutável gravada somente por backend confiável.

## Segurança

Todas as tabelas novas usam RLS. O papel `anon` não recebe acesso. O papel `authenticated` recebe apenas os privilégios exigidos, sempre combinados com políticas de associação à organização ou ao tenant. As funções auxiliares `security definer` ficam no schema privado, usam `search_path` vazio e não são executáveis por `public`.

## Limite desta fase

As tabelas operacionais existentes — produtos, pedidos, filiais, depósitos, estoque e financeiro — ainda não recebem `tenant_id`. Isso será feito por domínio em migrations posteriores, com backfill controlado para a Norte Sul (cliente zero). Até essa migração terminar, a fundação não torna o aplicativo multiempresa por si só.

## Sequência segura

1. Aplicar a migration em um projeto Supabase de desenvolvimento descartável.
2. Executar `supabase/tests/saas_foundation_smoke.sql`.
3. Criar organização Norte Sul e dois tenants: produção e demonstração.
4. Migrar identidade e permissões.
5. Tenantizar catálogo, filiais e estoque.
6. Tenantizar vendas, compras, financeiro e fiscal.
7. Somente depois promover ao ambiente publicado.
