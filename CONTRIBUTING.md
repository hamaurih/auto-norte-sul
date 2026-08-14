# Contribuição

## Fluxo

1. Crie uma branch curta e descritiva.
2. Faça alterações pequenas e verificáveis.
3. Execute `bunx tsc --noEmit` e `bun run build`.
4. Abra um Pull Request para `main`.
5. Não versione arquivos `.env`, segredos, tokens ou chaves privadas.

## Commits

Use mensagens objetivas no imperativo, por exemplo:

- `Adiciona conciliação de recebimento`
- `Corrige busca por código do fabricante`
- `Protege auditoria por tenant`

Evite mensagens genéricas como `Changes`, `Update` ou `Fix`.

## Banco de dados

- Toda alteração estrutural deve ter migration idempotente.
- Tabelas no schema público devem usar RLS e grants mínimos.
- Mudanças de estoque e custo precisam ser transacionais e auditáveis.
- Nunca aplique migrations DEV diretamente em produção sem homologação.
