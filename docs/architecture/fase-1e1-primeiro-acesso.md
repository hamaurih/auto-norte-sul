# Fase 1E.1 — Homologação operacional e primeiro acesso seguro

## Modelo de segurança

- **Nenhum acesso automático.** Ser o primeiro usuário autenticado não concede papel algum.
  Todo vínculo nasce de um convite de uso único ou de uma operação administrativa server-side.
- **Convites** ficam em `public.tenant_invitations`. Apenas o hash SHA-256 do token é
  armazenado; o token em claro é devolvido uma única vez ao administrador e nunca é registrado
  em log.
- **RLS** ativa na tabela, com `GRANT` explícito para `authenticated` e `service_role` e nenhum
  acesso para `anon`. As políticas de leitura, inserção e atualização exigem
  `private.has_organization_role(organization_id, array['owner','admin'])`, e a política de
  UPDATE define `USING` e `WITH CHECK`.
- **Funções privilegiadas** ficam no schema `private` (`hash_invitation_token`,
  `create_owner_invitation`) com `search_path` fixo, `execute` revogado de `PUBLIC` e concedido
  somente aos papéis necessários. As duas funções expostas ao app —
  `public.accept_tenant_invitation` e `public.my_access_context` — são `security definer`,
  com `search_path = ''` e `execute` apenas para `authenticated`.
- **Autorização** é baseada em `organization_memberships` e `tenant_memberships`. Nada é lido de
  `user_metadata`. O e-mail conferido no aceite vem do JWT (`auth.jwt() ->> 'email'`).
- **Sem service_role no frontend.** O convite é criado por server function autenticada, usando
  o cliente com RLS do próprio administrador.

## Primeiro owner (hamaurih@gmail.com)

Endereço autorizado para o primeiro convite owner da organização existente no Supabase de
desenvolvimento: **hamaurih@gmail.com**. O e-mail sozinho não concede nada — ele apenas define
para quem o convite de uso único é válido; o vínculo só nasce do aceite server-side.

1. Aplicar `supabase/phase-1e1/20260728140000_create_tenant_invitations.sql` no projeto de
   desenvolvimento.
2. Rodar, com a connection string do DEV:

   ```bash
   DEV_DATABASE_URL="postgresql://..." \
   OWNER_EMAIL="hamaurih@gmail.com" \
   ORG_SLUG="norte-sul" \
   APP_URL="http://localhost:8080" \
   ./scripts/bootstrap-owner-invite.sh
   ```

   O script gera o token localmente (`openssl rand -hex 32`), grava apenas o hash SHA-256 via
   `private.create_owner_invitation` (executável só por `service_role`) e imprime o link de
   ativação uma única vez. Não redirecione a saída para arquivo nem rode com `bash -x`.
3. O proprietário cria a conta / faz login normalmente pelo Supabase Auth com esse mesmo e-mail.
   Nenhuma senha é definida por nós e não existe credencial fixa no repositório.
4. Ele abre o link `/ativacao?token=…` (o token é removido da URL logo ao carregar) ou cola o
   código na tela de ativação. O aceite valida token, expiração, uso único e igualdade do e-mail
   contra o JWT — nunca `user_metadata` — e cria a associação `owner` na organização mais a
   associação em **todos** os tenants ativos (conta real e conta de teste).
5. A partir daí ele emite os demais convites em **Admin → Homologação**.

## Fluxo do aplicativo

- `/ativacao` — rota pública (exige sessão) com instruções e campo de token. Usuário autenticado
  sem vínculo cai aqui, nunca em erro genérico ou loop.
- `/admin` e `/admin/configuracoes` — redirecionam para `/ativacao` quando não há vínculo.
- `/admin/homologacao` — diagnóstico somente leitura (usuário, organização, tenant ativo,
  ambiente, papel, storefront, perfil da empresa), troca de ambiente autorizado, atalho para
  Configurações e gestão de convites para owner/admin. Nenhuma ação destrutiva.
- O seletor real/demo lista apenas ambientes onde o usuário tem associação ativa e troca somente
  o tenant ativo, preservando a sessão.

## Observação de tipos

`src/integrations/supabase/tenant-db.ts` é um façade temporário que mantém o código multiempresa
compilando enquanto `src/integrations/supabase/types.ts` não é regenerado no projeto conectado.
Deve ser removido depois que as migrations de tenant forem aplicadas e os tipos regenerados.
