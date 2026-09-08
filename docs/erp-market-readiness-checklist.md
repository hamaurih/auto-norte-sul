# Sequência de atualizações — ERP Norte Sul

Atualizado em 2026-09-08. Responsável pela execução: Codex, conforme autorização de Amauri nesta conversa.

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

- [x] Consultar advisors do projeto correto: `sistema norte sul` (`pzwjbitjersngordgcsh`).
- [x] Corrigir e testar `vehicle_reference_models`: migration `20260908233957_vehicle_reference_models_read_only_rls` aplicada em produção; RLS ativa, authenticated somente leitura, anon sem acesso e backend preservado. Teste transacional retornou `VEHICLE_REFERENCE_RLS_OK`, com 97 registros preservados; INSERT/UPDATE/DELETE negados para authenticated e SELECT negado para anon. Arquivo em `supabase/tests/vehicle_reference_models_read_only_rls.sql`.
- [ ] Revisar 29 funções SECURITY DEFINER acessíveis a authenticated; avaliar autorização individual antes de alterar privilégios. Triagem SQL confirmou as 29 sem EXECUTE para anon e com search_path vazio; referências de autorização existem, mas isso não substitui testes de isolamento por função.
- [x] Habilitar e confirmar proteção contra senhas vazadas: login confirmado no painel do projeto correto; opção Prevent use of leaked passwords ativada e salva. Nova consulta ao advisor não retorna auth_leaked_password_protection. Bloqueio de autenticação resolvido.
- [ ] Revisar alerta pg_net no schema public sem interromper o scheduler de enriquecimento.
- [x] Confirmar ausência de leitura por anon/authenticated na tabela server_admin_bridge_credentials: ambos sem SELECT, RLS ativa e zero políticas. A ausência de política é intencional para essa tabela de backend; não abrir acesso para eliminar aviso informativo.
- [ ] Corrigir os verificadores de código apenas onde houver falsa detecção comprovada, preservando checks de segurança.
- [ ] Revisar consultas legadas a user_roles e configuração de origem Bling apontadas pelo gate de núcleo ERP.
- [ ] Executar testes entre conta real, demo, usuário externo e perfis restritos; validar imagens e comissões.

Verificações iniciais: `node scripts/check-api-security.mjs` FALHOU (3 ocorrências); `node scripts/check-phase1-core.mjs` FALHOU (14 ocorrências). Alertas de nomes de guards não comprovam ausência de autenticação: cron e Stone possuem verificações específicas que precisam de testes próprios.

Advisors após a correção: o erro `rls_disabled_in_public` deixou de ser reportado. Os demais avisos não foram considerados resolvidos. A etapa 02 permanece sem OK e a etapa 03 não foi iniciada.

### Conhecimento prévio que exige revalidação

- Roadmap registra orçamentos e enriquecimento operacional em 08/09/2026. Não reconstruir sem examinar o que já existe.
- Gateway fiscal consultado aceita somente homologação e prepara/enfileira documentos. Não equivale a autorização fiscal.
- Peso/dimensões, expedição, devoluções e conciliação já têm código. Concluir/testar antes de chamar de ausentes.

## Política para aprovação final

Sem falhas críticas de acesso, estoque ou dinheiro; documentos fiscais autorizados e eventos testados; fechamento conciliado; restauração demonstrada; segunda empresa isolada e operacional. Nenhuma porcentagem de prontidão baseada apenas na quantidade de telas.
