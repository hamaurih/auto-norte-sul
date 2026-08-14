# Auto Deal Hub DEV

Crie uma plataforma de e-commerce para a empresa Norte Sul Acessórios, especializada em acessórios automotivos. O projeto deve ser construído como um ecossistema digital escalável, inicialmente como web app responsivo e futuramente preparado para virar aplicativo mobile e base para agente de IA.

A plataforma terá duas jornadas: B2C para consumidor final e B2B para lojistas, oficinas, instaladores e revendedores.

Use Supabase como backend principal, com autenticação, banco de dados, storage para imagens, controle de usuários, regras de acesso e estrutura preparada para integração com a API do Bling.

Crie as seguintes áreas:

1. Home estilo shopping:

- Banner principal.

- Menu de departamentos.

- Busca por produto, SKU, categoria, marca e aplicação.

- Vitrine de ofertas.

- Vitrine de lançamentos.

- Mais vendidos.

- Chamada para cadastro B2B.

- Seção de marcas.

- Rodapé com informações comerciais, políticas e contato.

2. Catálogo:

- Listagem de produtos.

- Filtros por categoria, marca, preço, estoque, aplicação e tipo de produto.

- Ordenação por mais vendidos, menor preço, maior preço e lançamentos.

- Cards com imagem, nome, preço, SKU e botão comprar.

3. Página de produto:

- Galeria de imagens.

- Nome do produto.

- SKU.

- Categoria.

- Marca.

- Descrição.

- Aplicação/compatibilidade.

- Estoque disponível.

- Preço B2C.

- Preço B2B visível apenas para usuários aprovados.

- Quantidade.

- Botão adicionar ao carrinho.

- Botão WhatsApp para dúvidas.

- Produtos relacionados.

4. Área B2B:

- Página “Compre no Atacado”.

- Formulário de cadastro B2B com CNPJ, razão social, nome fantasia, WhatsApp, cidade, segmento e volume médio de compra.

- Status de cadastro pendente.

- Após aprovação, liberar tabela de preço especial.

- Criar grupos de cliente: B2C, B2B_PENDENTE, REVENDEDOR, OFICINA, DISTRIBUIDOR, ADMIN e GERENTE.

5. Carrinho e checkout:

- Carrinho com produtos, quantidade, subtotal e total.

- Checkout com dados do cliente, endereço e forma de pagamento.

- Estrutura preparada para enviar pedido ao Bling.

- Histórico de pedidos para o cliente.

6. Painel administrativo:

- Dashboard com pedidos, clientes, produtos, estoque e cadastros B2B pendentes.

- Aprovar ou reprovar clientes B2B.

- Definir grupo comercial do cliente.

- Ver logs de sincronização com Bling.

- Gerenciar banners, categorias e vitrines.

- Ver pedidos e status.

7. Integração Bling:

- Criar estrutura de tabelas para armazenar produtos, imagens, categorias, estoque, preços, clientes, pedidos e logs de sincronização.

- Preparar camada de integração via API REST OAuth 2.0.

- Criar logs para produto, estoque, pedido e cliente.

- Criar estrutura para receber webhooks futuros do Bling.

8. Agente de IA:

- Criar base ai_knowledge_base para políticas, dúvidas frequentes, regras B2B e informações comerciais.

- Criar estrutura ai_product_embeddings para futura busca semântica de produtos.

- Preparar interface de chat para o cliente perguntar sobre produtos, estoque, aplicação, pedidos e condições B2B.

- O agente deve consultar dados estruturados antes de responder.

Design:

- Visual moderno, comercial e popular-premium.

- Estilo marketplace/shopping.

- Foco em facilidade de busca.

- Layout mobile-first.

- Cores fortes, com identidade automotiva.

- Cards limpos, produtos bem divididos, departamentos organizados.

Regras importantes:

- O preço B2B só aparece para usuários aprovados.

- Visitantes e clientes B2C veem apenas preço varejo.

- Usuário B2B pendente não acessa tabela atacado.

- Administrador pode alterar grupo do cliente.

- Produto sem estoque deve aparecer como indisponível ou ser ocultado conforme configuração.

- O sistema deve estar preparado para virar aplicativo mobile no futuro.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://auto-norte-sul.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c985baf7-7b14-49e3-ab6b-a8875f2691b8).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
