<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Regras obrigatórias para agentes

Antes de alterar comportamento funcional, arquitetura, banco, segurança ou interface, leia `docs/README.md` e os documentos canônicos afetados.

Ordem de referência:

1. `docs/08-DECISIONS.md`
2. `docs/01-PRD.md`
3. `docs/02-BUSINESS-FLOWS.md`
4. `docs/03-TRD.md`
5. `docs/04-DATA-MODEL.md`
6. `docs/05-UI-UX.md`
7. `docs/06-IMPLEMENTATION-PLAN.md`
8. `docs/07-ACCEPTANCE-TESTS.md`

Regras:

- não invente regra de negócio para preencher lacuna;
- se a feature mudar comportamento, atualize a documentação correspondente no mesmo PR;
- regras críticas de autorização, preço, desconto, tenant, estoque, pagamento e transição de estado devem ser validadas no backend;
- mudanças de schema exigem migration versionada e revisão de RLS;
- não considere uma feature pronta sem os critérios de aceite relevantes;
- não contorne checks obrigatórios de CI;
- não faça force-push/rebase de histórico publicado sincronizado com Lovable.

Quando código e documentação canônica divergirem sem uma decisão registrada, trate a divergência como bug ou dívida técnica a ser resolvida explicitamente.