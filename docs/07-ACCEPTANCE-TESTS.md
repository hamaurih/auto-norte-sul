# Critérios de Aceite e Testes

Status: canônico
Atualização: 2026-10-16

## 1. Regra geral

Nenhuma feature é considerada concluída apenas porque renderiza ou compila. Ela precisa provar o comportamento esperado e as principais exceções.

## 2. Matriz mínima por feature

Para cada entrega, cobrir quando aplicável:
- happy path;
- permissão negada;
- dado inválido;
- duplicidade/idempotência;
- falha de integração;
- concorrência/estoque insuficiente;
- cancelamento/estorno;
- responsividade;
- auditoria/log;
- isolamento entre tenants.

## 3. Cenários críticos obrigatórios

### B2C
- produto disponível pode ser comprado;
- produto sem estoque não conclui venda indevida;
- callback duplicado não duplica pedido/recebimento;
- cancelamento/estorno atualiza estados relacionados;
- retirada em loja reserva e libera estoque corretamente.

### B2B
- pendente não vê preço especial;
- aprovado vê somente a faixa correta;
- desconto acima do limite é bloqueado;
- usuário de outro tenant não acessa regra comercial alheia.

### Estoque
- compra aumenta saldo no depósito correto;
- venda reduz uma única vez;
- transferência preserva total global;
- devolução apta recompõe saldo;
- ajuste deixa trilha de auditoria.

### Financeiro
- venda gera recebível quando aplicável;
- pagamento baixa somente uma vez;
- estorno reverte efeito financeiro sem apagar histórico;
- contas a pagar não podem ser baixadas por usuário sem permissão;
- fluxo de caixa reconcilia com movimentos base.

### PDV
- leitor/código adiciona item correto;
- desconto respeita limite;
- venda não duplica sob clique/retry;
- estoque e financeiro refletem a venda concluída.

### Segurança
- RLS impede leitura/escrita indevida;
- usuário comum não executa ação administrativa;
- service role não aparece no bundle cliente;
- funções privilegiadas validam autorização e tenant.

## 4. Gates de CI

Os checks obrigatórios configurados na `main` devem permanecer verdes antes do merge. Falha de check é bloqueio de entrega, não aviso.

## 5. Evidência de aceite

Para módulos de risco alto, registrar no PR:
- cenários testados;
- resultado;
- migration aplicada quando houver;
- impacto em dados existentes;
- evidência de homologação;
- limitações conhecidas.

## 6. Severidade

- P0: perda/corrupção de dados, exposição crítica, venda/fiscal/financeiro incorreto em escala — bloqueia produção imediatamente.
- P1: fluxo principal quebrado ou risco material — bloqueia release.
- P2: defeito relevante com workaround — pode entrar em backlog priorizado.
- P3: cosmético/baixo impacto — não bloqueia isoladamente.