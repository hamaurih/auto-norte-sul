# Sequência de atualizações — ERP Norte Sul

Atualizado em 2026-09-11. Responsável pela execução: Codex, conforme autorização de Amauri nesta conversa.

## Regra de execução

Executar na ordem abaixo. Marcar **OK** somente com implementação, verificação e evidência registradas. Código existente, tela disponível, deploy READY ou ausência de alertas isoladamente não comprovam funcionamento do módulo. Não avançar a etapa dependente enquanto o requisito anterior estiver reprovado. Subitens concluídos podem receber OK sem aprovar a etapa inteira. Quando houver impedimento externo, registrar exatamente o bloqueio; não inventar aprovação nem execução futura em segundo plano.

Estados: PENDENTE, EM EXECUÇÃO, BLOQUEADO, OK. Para cada entrega registrar commit/migration, teste, ambiente, resultado e limitações. Não registrar segredos, dados pessoais ou certificados neste repositório público.

## Checklist mestre

| Ordem | Atualização | Critério para OK | Estado |
|---|---|---|---|
| 01 | Confirmar repositório e versão publicada | Commit do checkout corresponde ao deployment do domínio oficial | OK |
| 02 | Segurança: RLS, RPCs, permissões, arquivos e autenticação | Acessos permitidos funcionam; anon, externo, vendedor e outra empresa não atravessam limites; revisão de alertas e testes registrados | EM EXECUÇÃO |
| 03 | Recuperação e operação técnica | Backup restaurado em ambiente isolado; monitoramento, alertas e procedimento de reversão verificados | PENDENTE |
| 04 | Migração e fonte oficial dos dados | Produtos, clientes, estoque, preços, custos e títulos conciliados com relatório das diferenças; entrada legada não sobrescreve ERP | PENDENTE |
| 05 | Estoque e reservas | Concorrência pela última unidade, expiração, inventário, transferência e devolução preservam saldos por depósito | PENDENTE |
| 06 | Pagamentos e estornos | Confirmação no provedor, repetição e reordenação de eventos, valor divergente e falha transitória não duplicam efeitos | PENDENTE |
| 07 | Cadastros fiscais e credenciais | Emitente, produtos, operações, certificado e ambientes validados; segredos por empresa no servidor | PENDENTE |
| 08 | Emissão fiscal completa | XML assinado, schema, transmissão, protocolo, consulta e DANFE comprovados em homologação e liberação de produção controlada | PENDENTE |
| 09 | Eventos fiscais e atualização tributária | Cancelamento, inutilização, devolução, contingência aplicável e leiautes IBS/CBS testados conforme escopo fiscal | PENDENTE |
| 10 | Financeiro e conciliação | Pagar/receber, parcelas, baixas parciais, juros, descontos, taxas e extratos conciliam | PENDENTE |
| 11 | Gestão financeira e contabilidade | Centros de custo, caixa projetado, DRE gerencial, fechamento, bloqueio de período e exportação conferidos | PENDENTE |
| 12 | Compras e fornecedores | Cotação, aprovação, recebimento parcial, divergência, devolução e rateio afetam estoque/custo/financeiro corretamente | PENDENTE |
| 13 | PDV e fechamento de caixa | Abertura, sangria, suprimento, pagamentos mistos, descontos e recuperação após interrupção testados | PENDENTE |
| 14 | Orçamentos e pedidos | Proposta enviada imutável, revisões, follow-up e conversão única para pedido; vendas parciais e cancelamentos coerentes | PENDENTE |
| 15 | B2B, crédito e cobrança | Tabelas por cliente, limite, prazo, inadimplência e exceções aprovadas respeitados no servidor | PENDENTE |
| 16 | Comissões e vendedores | Regra com vigência e memória de cálculo; devoluções/cancelamentos estornam corretamente; visibilidade restrita | PENDENTE |
| 17 | Trocas, devoluções e garantias | Casos parciais, crédito, defeito e retorno ao fornecedor conciliam estoque, financeiro, comissão e fiscal | PENDENTE |
| 18 | Frete e expedição | Peso/dimensões, embalagem, cotação, separação, conferência, etiqueta, entrega parcial e rastreio completos | PENDENTE |
| 19 | Catálogo e aplicações automotivas | Origem, códigos, equivalências, veículo/ano/motor/versão e imagens revisados; pendências mensuradas | PENDENTE |
| 20 | Formação de preços | Margem por canal inclui custo, descontos, comissão, taxas e frete subsidiado; aprovação de exceções | PENDENTE |
| 21 | Reposição e indicadores | ABC, giro, cobertura, lead time e produtos parados produzem sugestões conferíveis | PENDENTE |
| 22 | Site integrado e experiência de uso | Catálogo, login, B2B, carrinho, pagamento e pedidos completos em desktop/celular; tabelas, filtros e atalhos adequados | PENDENTE |
| 23 | IA de vendas e relacionamento | Respostas consultam dados autorizados e atuais; dúvida sobre aplicação vai ao humano; acompanhamento comercial mensurável | PENDENTE |
| 24 | Marketplaces | Publicação/variações, preço, estoque, pedidos, taxas e devoluções testados nos canais contratados | PENDENTE |
| 25 | Operação independente do Bling | Ciclo compra → recebimento → venda → pagamento → fiscal → entrega → conciliação fechado, com estornos; saldos reconciliados no corte | PENDENTE |
| 26 | Implantação multiempresa | Nova empresa, proprietário, filiais, depósitos, domínio e configurações independentes sem SQL manual; isolamento novamente testado | PENDENTE |
| 27 | Migração comercial e saída | Importação com prévia/erros/reconciliação; exportação completa e encerramento controlado | PENDENTE |
| 28 | Planos e cobrança SaaS | Assinaturas, módulos, limites, alteração de plano e cancelamento funcionam conforme contrato | PENDENTE |
| 29 | Suporte, privacidade e documentação | Ajuda, chamados, acesso assistido temporário/auditado, escopo e responsabilidades definidos e revisados | PENDENTE |
| 30 | Capacidade e custo por cliente | Carga representativa, tempos-alvo, limites, observabilidade por empresa e custos medidos | PENDENTE |
| 31 | Piloto com segunda empresa | Implantação repetível e período operacional completo, com fechamento e nenhuma falha crítica pendente | PENDENTE |
| 32 | Liberação comercial | Critérios anteriores aprovados; escopo suportado, suporte, recuperação e manutenção disponíveis | PENDENTE |

## Evidências e execução atual

### 01 — OK: base publicada

- Repositório: `hamaurih/auto-norte-sul`, branch `main`.
- Commit verificado: `a65df872ce033890b7eb8fcece3f6d0adb15da0a`.
- Vercel: projeto `auto-norte-sul`, deployment `dpl_AXmTgFxdmQE9Uuy4qTMi8UqCNgL9`, production, READY.
- Aliases conferidos no deployment: `nortesulauto.com.br` e `www.nortesulauto.com.br`.
- Evidência: Vercel get_deployment e git log concordam. Esse OK confirma a base; não aprova a saúde funcional do ERP.

### 02 — EM EXECUÇÃO: segurança

- [x] Cobertura RLS pública confirmada e bypass de usuário sem associação removido.
- [x] Isolamento básico real/demo/sem associação validado.
- [x] Proteção contra senhas vazadas ativada.
- [x] Superfície pública de RPCs privilegiadas reduzida: **0 funções `SECURITY DEFINER` executáveis por `authenticated` e 0 por `anon`** após as migrations `secure_authenticated_security_definer_rpcs` e `secure_remaining_authenticated_security_definer_rpcs`.
- [x] Telemetria `search_no_result_logs` sem INSERT direto por `anon` ou `authenticated`; escrita passa por RPC estreita, tenant-scoped, com supressão de duplicata e rate limit.
- [x] Dependências de autorização em runtime de `user_roles` removidas dos fluxos de usuários, vendedores, Bling, saneamento e gestão de usuários; autorização atual usa `tenant_memberships`.
- [x] Verificado que os 2 administradores legados existentes já possuem membership administrativo ativo antes da retirada do fallback.
- [ ] Completar testes operacionais com perfis restritos (vendedor/consulta/externo), incluindo comissão, uploads e tentativa de atravessar tenant. A arquitetura está endurecida, mas o aceite exige evidência funcional por perfil.
- [ ] `pg_net` permanece em `public`. Advisor mantém WARN; a extensão não deve ser movida/recriada de forma destrutiva enquanto estiver vinculada ao scheduler.
- [x] `server_admin_bridge_credentials` permanece com RLS ativa e sem políticas de acesso de cliente. O INFO do advisor representa negação intencional, não abertura de dados.

Advisors em 2026-09-11: nenhum alerta de RLS desabilitada, nenhuma RPC privilegiada exposta a `authenticated`/`anon`; permanecem somente `server_admin_bridge_credentials` sem policy (negação intencional) e `pg_net` em `public`.

### Fase de Homologação Controlada — estado em 2026-09-11

| Item | Estado | Evidência atual |
|---|---|---|
| Corrigir bloqueadores de segurança | **EM VALIDAÇÃO FINAL** | 33 RPCs privilegiadas expostas a authenticated no início da revisão; agora 0. Escrita pública da telemetria fechada e autorização legada removida. Falta teste funcional dos perfis restritos/key users. |
| Ambiente de homologação separado da conta real | **PARCIAL** | Tenant `Norte Sul — Demonstração` está isolado logicamente e recebeu somente dados QA. Existe Supabase fisicamente separado `auto-deal-hub-dev`, porém está defasado e não é aceito como staging oficial até sincronização/reconstrução. |
| Dados fictícios e roteiros por setor | **OK — BASE INICIAL** | 12 casos formais no tenant demo; massa QA com filial, 2 depósitos, 3 produtos, fornecedor, 4 clientes (B2C + A/B/C), tabela B2B, recebível e pedido de compra draft. |
| Executar fluxos críticos com key users | **PENDENTE** | `homologation_test_runs = 0`. Smoke tests técnicos não substituem homologação humana. |
| Registrar aprovado/falhou/bloqueado/reteste | **OK — MECANISMO** | Tabelas `homologation_test_cases`, `homologation_test_runs` e UI `/admin/homologacao` publicadas; histórico append-only com evidência, responsável e data. Trigger de banco bloqueia criação/execução formal no tenant `production`. |
| Liberar somente com críticos zerados e aceite formal | **OK — TRAVA / NÃO LIBERADO** | Trigger de banco bloqueia aceite se qualquer crítico não estiver aprovado e bloqueia aceite direto no tenant de produção. Há 9 casos críticos, 0 execuções e 0 aceites. |

Roteiros iniciais: SEG-001/002, EST-001/002, CMP-001, FIN-001/002, PDV-001, B2B-001, FIS-001, WEB-001 e REC-001.

Correções encontradas durante a preparação da homologação:
- Contas a pagar gravava `status=open` enquanto a constraint rejeitava esse status; contrato corrigido.
- Contas a pagar gravava `kind=payable` enquanto o modelo exige `fixed|variable`; agora deriva `default_kind` da categoria.
- Recebíveis manuais reutilizavam `source_id=null` em uma constraint `UNIQUE NULLS NOT DISTINCT`; agora cada lançamento manual recebe identidade UUID própria.
- Smoke tests transacionais aprovados para lançamento a pagar em `open` e múltiplos recebíveis manuais; testes foram revertidos após validação e não contam como aceite de key user.

Observação de infraestrutura: `list_branches` ainda informa `MIGRATIONS_FAILED` no branch `main`, metadata originada em julho. A história de migrations, entretanto, contém normalmente as migrations recentes aplicadas até `seed_demo_homologation_fixtures`. Tratar o status como anomalia a investigar antes de certificar staging/recuperação, sem inferir falha atual de schema apenas pela flag.

### Conhecimento prévio que exige revalidação

- Roadmap registra orçamentos e enriquecimento operacional em 08/09/2026. Não reconstruir sem examinar o que já existe.
- Gateway fiscal consultado aceita somente homologação e prepara/enfileira documentos. Não equivale a autorização fiscal.
- Peso/dimensões, expedição, devoluções e conciliação já têm código. Concluir/testar antes de chamar de ausentes.

## Política para aprovação final

Sem falhas críticas de acesso, estoque ou dinheiro; documentos fiscais autorizados e eventos testados; fechamento conciliado; restauração demonstrada; segunda empresa isolada e operacional. Nenhuma porcentagem de prontidão baseada apenas na quantidade de telas.