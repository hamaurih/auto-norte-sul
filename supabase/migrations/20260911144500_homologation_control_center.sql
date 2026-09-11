-- Controlled homologation center: auditable test cases, immutable executions and
-- formal release acceptance with a database-enforced critical-test gate.

create table if not exists public.homologation_test_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  sector text not null,
  title text not null,
  description text,
  preconditions text,
  steps jsonb not null default '[]'::jsonb,
  expected_result text not null,
  criticality text not null default 'medium'
    check (criticality in ('critical','high','medium','low')),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.homologation_test_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  test_case_id uuid not null references public.homologation_test_cases(id) on delete cascade,
  status text not null
    check (status in ('approved','failed','blocked','retest')),
  evidence_url text,
  evidence_notes text,
  executed_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  executed_at timestamptz not null default now(),
  constraint homologation_run_evidence_url_length check (evidence_url is null or length(evidence_url) <= 1500),
  constraint homologation_run_evidence_notes_length check (evidence_notes is null or length(evidence_notes) <= 8000)
);

create table if not exists public.homologation_release_acceptances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  release_name text not null,
  release_version text,
  decision text not null check (decision in ('accepted','rejected')),
  statement text not null,
  accepted_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists homologation_cases_tenant_sector_idx
  on public.homologation_test_cases(tenant_id, active, sector, sort_order);
create index if not exists homologation_runs_case_executed_idx
  on public.homologation_test_runs(test_case_id, executed_at desc);
create index if not exists homologation_runs_tenant_status_idx
  on public.homologation_test_runs(tenant_id, status, executed_at desc);
create index if not exists homologation_acceptances_tenant_idx
  on public.homologation_release_acceptances(tenant_id, accepted_at desc);

alter table public.homologation_test_cases enable row level security;
alter table public.homologation_test_runs enable row level security;
alter table public.homologation_release_acceptances enable row level security;

revoke all on public.homologation_test_cases from anon;
revoke all on public.homologation_test_runs from anon;
revoke all on public.homologation_release_acceptances from anon;

grant select, insert, update, delete on public.homologation_test_cases to authenticated;
grant select, insert on public.homologation_test_runs to authenticated;
grant select, insert on public.homologation_release_acceptances to authenticated;

drop policy if exists homologation_cases_read_member on public.homologation_test_cases;
create policy homologation_cases_read_member
on public.homologation_test_cases for select to authenticated
using (
  private.has_tenant_role(
    tenant_id,
    array['owner','admin','manager','sales','cashier','stock','finance','accountant','support','viewer']::text[]
  )
);

drop policy if exists homologation_cases_manage_admin on public.homologation_test_cases;
create policy homologation_cases_manage_admin
on public.homologation_test_cases for all to authenticated
using (
  private.has_tenant_role(tenant_id, array['owner','admin','manager']::text[])
)
with check (
  private.has_tenant_role(tenant_id, array['owner','admin','manager']::text[])
);

drop policy if exists homologation_runs_read_member on public.homologation_test_runs;
create policy homologation_runs_read_member
on public.homologation_test_runs for select to authenticated
using (
  private.has_tenant_role(
    tenant_id,
    array['owner','admin','manager','sales','cashier','stock','finance','accountant','support','viewer']::text[]
  )
);

drop policy if exists homologation_runs_insert_member on public.homologation_test_runs;
create policy homologation_runs_insert_member
on public.homologation_test_runs for insert to authenticated
with check (
  executed_by = auth.uid()
  and private.has_tenant_role(
    tenant_id,
    array['owner','admin','manager','sales','cashier','stock','finance','accountant','support','viewer']::text[]
  )
  and exists (
    select 1
    from public.homologation_test_cases c
    where c.id = test_case_id
      and c.tenant_id = public.homologation_test_runs.tenant_id
      and c.active
  )
);

drop policy if exists homologation_acceptances_read_member on public.homologation_release_acceptances;
create policy homologation_acceptances_read_member
on public.homologation_release_acceptances for select to authenticated
using (
  private.has_tenant_role(
    tenant_id,
    array['owner','admin','manager','sales','cashier','stock','finance','accountant','support','viewer']::text[]
  )
);

drop policy if exists homologation_acceptances_insert_admin on public.homologation_release_acceptances;
create policy homologation_acceptances_insert_admin
on public.homologation_release_acceptances for insert to authenticated
with check (
  accepted_by = auth.uid()
  and private.has_tenant_role(tenant_id, array['owner','admin','manager']::text[])
);

create or replace function private.enforce_homologation_release_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_environment text;
begin
  if new.decision = 'accepted' then
    select t.environment into v_environment
    from public.tenants t
    where t.id = new.tenant_id;

    if coalesce(v_environment, 'production') = 'production' then
      raise exception 'Aceite formal deve ser registrado no ambiente de homologação, nunca no tenant de produção'
        using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.homologation_test_cases c
      where c.tenant_id = new.tenant_id
        and c.active
        and c.criticality = 'critical'
        and coalesce(
          (
            select r.status
            from public.homologation_test_runs r
            where r.test_case_id = c.id
              and r.tenant_id = c.tenant_id
            order by r.executed_at desc, r.id desc
            limit 1
          ),
          'not_run'
        ) <> 'approved'
    ) then
      raise exception 'Aceite bloqueado: existem testes críticos sem aprovação'
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$$;

revoke all on function private.enforce_homologation_release_gate() from public, anon, authenticated;

drop trigger if exists trg_homologation_release_gate on public.homologation_release_acceptances;
create trigger trg_homologation_release_gate
before insert on public.homologation_release_acceptances
for each row execute function private.enforce_homologation_release_gate();

insert into public.homologation_test_cases
  (tenant_id, code, sector, title, description, preconditions, steps, expected_result, criticality, sort_order)
select
  t.id,
  seed.code,
  seed.sector,
  seed.title,
  seed.description,
  seed.preconditions,
  seed.steps,
  seed.expected_result,
  seed.criticality,
  seed.sort_order
from public.tenants t
cross join (
  values
    ('SEG-001','Segurança','Isolamento entre operação real e demonstração',
     'Validar que um usuário associado somente a um tenant não lê nem altera dados do outro.',
     'Usuário de teste com associação ativa em apenas um ambiente.',
     jsonb_build_array('Entrar com o usuário restrito','Consultar catálogo e dados administrativos do tenant autorizado','Trocar o contexto para o outro tenant e repetir leitura/alteração'),
     'Acesso permitido somente no tenant autorizado; leitura e escrita negadas no outro.', 'critical', 10),
    ('SEG-002','Segurança','Visibilidade de comissão por perfil',
     'Garantir que comissão e memória de cálculo não sejam expostas a vendedor, caixa ou usuário externo.',
     'Perfis administrativos e restritos criados no ambiente de demonstração.',
     jsonb_build_array('Entrar como administrador e conferir comissão','Entrar como vendedor/caixa','Tentar consultar tela e API/RPC relacionadas'),
     'Somente owner/admin/manager visualizam dados de comissão.', 'critical', 20),
    ('EST-001','Estoque','Concorrência pela última unidade',
     'Executar duas vendas/reservas concorrentes para o mesmo saldo final.',
     'Produto fictício com estoque exatamente 1 no depósito de homologação.',
     jsonb_build_array('Abrir duas sessões de venda','Reservar/vender a mesma unidade em ambas','Concluir a primeira e tentar concluir a segunda','Conferir saldo e movimentos'),
     'Apenas uma operação conclui; não existe estoque negativo nem duplicidade de baixa.', 'critical', 30),
    ('EST-002','Estoque','Troca, devolução e quarentena',
     'Validar retorno ao estoque vendável, quarentena e produto substituído.',
     'Venda fictícia concluída com item elegível para troca.',
     jsonb_build_array('Registrar devolução','Escolher destino vendável ou quarentena','Substituir produto quando aplicável','Conferir saldos e trilha de movimentos'),
     'Saldos, depósito especial e histórico ficam coerentes, sem duplicidade.', 'high', 40),
    ('CMP-001','Compras','Pedido de compra até recebimento',
     'Validar pedido, aprovação, recebimento parcial/total, custo e estoque.',
     'Fornecedor e produtos fictícios cadastrados.',
     jsonb_build_array('Criar pedido','Aprovar','Receber parcialmente','Receber saldo','Conferir estoque, custo real e contas a pagar'),
     'Recebimentos alteram estoque/custo/financeiro apenas uma vez e respeitam quantidades.', 'critical', 50),
    ('FIN-001','Financeiro','Contas a pagar com parcelas e aprovação',
     'Validar geração por compra, parcelamento, aprovação, baixa e anexos.',
     'Compra de homologação aprovada.',
     jsonb_build_array('Gerar título pela compra','Parcelar','Aprovar título','Registrar baixa parcial e final','Conferir saldo e histórico'),
     'Parcelas, aprovações, saldo e histórico financeiro permanecem conciliados.', 'critical', 60),
    ('FIN-002','Financeiro','Contas a receber e fluxo de caixa',
     'Validar geração do recebível, vencimento, baixa e reflexo no caixa projetado.',
     'Venda fictícia a prazo.',
     jsonb_build_array('Gerar recebível','Conferir vencimento e valor','Registrar baixa','Conferir fluxo de caixa e saldo'),
     'Recebível é liquidado uma única vez e o fluxo de caixa reflete a operação.', 'high', 70),
    ('PDV-001','PDV','Ciclo completo de caixa',
     'Validar abertura, venda, pagamentos, sangria/suprimento, cancelamento e fechamento.',
     'Caixa e terminal de homologação configurados.',
     jsonb_build_array('Abrir caixa','Registrar suprimento','Realizar venda com pagamento','Registrar sangria','Cancelar uma venda de teste','Fechar caixa'),
     'Valores e movimentos conciliam; cancelamento reverte estoque e financeiro corretamente.', 'critical', 80),
    ('B2B-001','B2B','Tabela A/B/C, crédito e aprovação',
     'Validar preço por CNPJ, limite de crédito e exceções.',
     'Clientes fictícios vinculados às tabelas A, B e C.',
     jsonb_build_array('Entrar com cada cliente','Conferir preço aplicado','Simular pedido dentro e acima do limite','Validar aprovação de exceção'),
     'Preço e crédito respeitam configuração do cliente e bloqueiam exceções não aprovadas.', 'critical', 90),
    ('FIS-001','Fiscal','NF-e em homologação SEFAZ',
     'Validar cadastro, certificado, XML, assinatura, transmissão, protocolo e DANFE no ambiente de homologação.',
     'Emitente fiscal e certificado A1 de homologação configurados; dados fictícios válidos.',
     jsonb_build_array('Gerar documento fiscal','Validar XML/schema','Assinar','Transmitir para homologação','Consultar protocolo','Gerar DANFE'),
     'Documento autorizado em homologação, com protocolo e DANFE correspondentes.', 'critical', 100),
    ('WEB-001','E-commerce','Catálogo, login, carrinho e pedido',
     'Executar jornada completa no site em desktop e celular usando ambiente de demonstração.',
     'Produtos fictícios publicados e usuário de teste.',
     jsonb_build_array('Abrir catálogo','Pesquisar produto','Entrar na conta','Adicionar ao carrinho','Simular checkout','Conferir pedido no ERP'),
     'Jornada conclui sem cruzar dados de produção e o pedido aparece uma única vez no ERP.', 'high', 110),
    ('REC-001','Recuperação','Restauração e reversão',
     'Comprovar que backup/restauração e rollback operacional funcionam em ambiente isolado.',
     'Snapshot/backup disponível e procedimento documentado.',
     jsonb_build_array('Restaurar cópia em ambiente isolado','Validar tabelas críticas','Executar smoke test','Registrar evidências e tempo de recuperação'),
     'Dados restaurados são íntegros e o procedimento é repetível sem tocar produção.', 'critical', 120)
) as seed(code,sector,title,description,preconditions,steps,expected_result,criticality,sort_order)
where t.environment = 'demo'
on conflict (tenant_id, code) do nothing;

comment on table public.homologation_test_cases is
  'Controlled QA/homologation scripts per tenant. Production release acceptance is gated by critical cases.';
comment on table public.homologation_test_runs is
  'Append-only homologation execution history with status, evidence and responsible user.';
comment on table public.homologation_release_acceptances is
  'Formal release acceptance/rejection records; accepted releases require all active critical cases approved.';

notify pgrst, 'reload schema';
