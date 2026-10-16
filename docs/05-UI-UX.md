# UI/UX — Norte Sul Auto

Status: canônico
Atualização: 2026-10-16

## 1. Princípios

- mobile-first;
- busca de produto como ação central;
- clareza comercial acima de efeitos visuais;
- estados de carregamento, vazio, erro e sucesso obrigatórios;
- ações críticas com confirmação e feedback;
- acessibilidade básica: contraste, foco, rótulos e navegação por teclado onde aplicável.

## 2. E-commerce

### Cabeçalho
Busca em destaque, departamentos, conta, carrinho e acesso B2B. Em mobile, preservar busca e carrinho como prioridades.

### Home
Hero/banner controlável pelo admin, departamentos, ofertas, lançamentos, mais vendidos, marcas e CTA B2B. Evitar blocos que ocupem espaço sem função comercial mensurável.

### Catálogo
Filtros claros, ordenação, paginação/infinite scroll previsível, cards consistentes e indicação objetiva de indisponibilidade.

### Produto
Imagem, nome, SKU, marca, aplicação, disponibilidade, preço conforme perfil, quantidade, entrega/retirada e CTA principal. Informações de compatibilidade automotiva devem ser inequívocas.

### Checkout
Menor número possível de etapas sem sacrificar validação. Mostrar resumo, endereço/retirada, pagamento, frete e total antes da confirmação.

## 3. ERP/Admin

- navegação por módulos;
- tabelas com busca, filtros e ordenação;
- ações em lote somente quando seguras;
- estados e valores financeiros com formatação consistente;
- edição crítica deve mostrar contexto suficiente para evitar alteração do registro errado;
- dashboards devem usar métricas reconciliadas com a fonte transacional.

## 4. PDV

Fluxo otimizado para teclado/leitor de código de barras, baixa latência percebida, foco permanente na inclusão de itens e prevenção de venda duplicada. Total, desconto, forma de pagamento e troco devem permanecer visíveis na finalização.

## 5. Design system

Componentes reutilizáveis devem cobrir: botões, inputs, selects, modais, drawers, tabelas, cards, badges de status, toasts, skeletons, paginação, confirmação destrutiva e feedback de erro.

## 6. Estados de domínio

Status de pedido, pagamento, estoque, fiscal e B2B devem possuir labels e badges padronizados. Não criar nomes de estado apenas na UI: o estado deve corresponder ao contrato de backend.

## 7. Critério de aceite visual

Uma tela não está pronta se funcionar apenas no desktop, se faltar feedback de erro/carregamento, se esconder informação crítica ou se divergir das regras de negócio descritas nos documentos canônicos.