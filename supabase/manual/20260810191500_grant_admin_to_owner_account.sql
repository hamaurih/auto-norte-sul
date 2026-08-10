-- Ação administrativa autorizada pelo proprietário (ambiente DEV: pleuoxzocgoajmymipqi).
--
-- Objetivo: promover a conta JÁ EXISTENTE hamaurih@gmail.com de cliente para o
-- maior papel administrativo previsto pelo modelo real deste banco
-- (public.app_role = 'admin', usado por public.user_roles / has_role e pelo
-- guard da rota /admin).
--
-- Como aplicar: painel do Supabase DEV pleuoxzocgoajmymipqi -> SQL Editor ->
-- colar e executar. Não requer service_role no repositório nem no frontend.
--
-- Propriedades:
--  * Idempotente: rodar N vezes produz o mesmo estado.
--  * Transacional: nada é aplicado parcialmente.
--  * Não cria usuário, não altera senha, não toca RLS, políticas ou GRANTs.
--  * Não concede admin automaticamente a novos cadastros (nenhum trigger novo).

begin;

do $$
declare
  v_user_id uuid;
begin
  select id
    into v_user_id
    from auth.users
   where lower(email) = lower('hamaurih@gmail.com')
   order by created_at
   limit 1;

  if v_user_id is null then
    raise exception 'Conta hamaurih@gmail.com não encontrada em auth.users. Faça login/cadastro dessa conta antes de rodar este script.';
  end if;

  -- Garante que o perfil exista (o trigger padrão normalmente já criou).
  insert into public.profiles (id)
  values (v_user_id)
  on conflict (id) do nothing;

  -- Concede o papel administrativo máximo do modelo atual.
  insert into public.user_roles (user_id, role)
  values (v_user_id, 'admin'::public.app_role)
  on conflict (user_id, role) do nothing;

  -- Trilha de auditoria: gravada somente se a tabela existir neste ambiente.
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'audit_events'
  ) then
    execute format(
      'insert into public.audit_events (action, entity, entity_id, metadata) values (%L, %L, %L, %L::jsonb)',
      'role.grant',
      'user_roles',
      v_user_id::text,
      json_build_object('email', 'hamaurih@gmail.com', 'role', 'admin', 'reason', 'owner authorized bootstrap')::text
    );
  end if;

  raise notice 'Papel admin garantido para %', v_user_id;
end
$$;

commit;

-- Validação obrigatória após aplicar:
select u.email, r.role, r.user_id
  from auth.users u
  join public.user_roles r on r.user_id = u.id
 where lower(u.email) = lower('hamaurih@gmail.com');
