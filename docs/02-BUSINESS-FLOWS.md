# Fluxos e Regras de Negócio — Norte Sul Auto

Status: canônico
Atualização: 2026-10-16

## 1. Fluxo B2C

1. Usuário acessa catálogo.
2. Busca/filtra produto.
3. Sistema valida publicação e estoque.
4. Usuário adiciona ao carrinho.
5. Escolhe entrega ou retirada em loja.
6. Informa/valida dados.
7. Escolhe pagamento.
8. Sistema cria pedido de forma idempotente.
9. Pagamento confirmado altera status do pedido.
10. Estoque é reservado/baixado conforme política vigente.
11. Pedido segue para separação, faturamento e entrega/retirada.
12. Cliente acompanha status em Minhas Compras.

Exceções obrigatórias: falha de pagamento, estoque insuficiente, produto despublicado durante checkout, duplicidade de callback, cancelamento, estorno, devolução e retirada não concluída.

## 2. Fluxo B2B

1. Empresa envia cadastro com CNPJ e dados comerciais.
2. Cadastro nasce como `B2B_PENDENTE`.
3. Perfil autorizado aprova/reprova e define segmento/faixa.
4. Após aprovação, cliente passa a visualizar preço/tabela correspondente.
5. Regras de limite, desconto e condição comercial devem ser aplicadas no backend, nunca apenas na interface.

## 3. Fluxo PDV

1. Vendedor identifica cliente quando necessário.
2. Produtos são adicionados por busca/código de barras.
3. Sistema valida depósito, estoque, preço e limite de desconto.
4. Pagamento é registrado.
5. Venda é persistida uma única vez.
6. Estoque é baixado no depósito correto.
7. Comissão é calculada conforme regra vigente.
8. Documento fiscal é emitido quando aplicável.
9. Caixa/financeiro recebe o movimento correspondente.

## 4. Compra e entrada de estoque

1. Pedido de compra é criado.
2. Fornecedor e itens são validados.
3. Recebimento pode ser parcial.
4. Entrada gera movimentação de estoque no depósito correto.
5. Custo é atualizado segundo política definida.
6. Contas a pagar são geradas quando aplicável.
7. Divergências de quantidade/preço devem ficar registradas.

## 5. Transferência entre depósitos

1. Origem valida saldo disponível.
2. Transferência é criada com status rastreável.
3. Saída da origem e entrada no destino devem formar uma operação atômica ou reconciliável.
4. Cancelamento não pode deixar saldo órfão.

## 6. Substituição/devolução

- item devolvido apto retorna ao estoque;
- item defeituoso/avariado segue destino específico;
- crédito, estorno ou nova venda precisam estar vinculados à operação original;
- comissão e financeiro devem ser recalculados quando a devolução afetar receita.

## 7. Contas a pagar

Criação → aprovação quando exigida → vencimento → pagamento → conciliação. Alterações de valor, vencimento e baixa devem ser auditáveis.

## 8. Contas a receber

Origem da venda → título/parcela → recebimento → baixa → conciliação. Estorno/cancelamento deve reverter o efeito financeiro de forma rastreável.

## 9. Retirada em loja

Checkout → seleção da loja → reserva → pagamento/condição → separação → pronto para retirada → identificação do cliente → entrega → conclusão. Reserva vencida deve liberar estoque conforme regra definida.

## 10. Regra de mudança

Nenhum agente deve implementar um novo fluxo de negócio sem:

1. identificar o fluxo afetado;
2. registrar estados e exceções;
3. validar impacto em estoque, financeiro, fiscal e permissões;
4. atualizar este documento e os testes de aceite quando houver mudança de comportamento.