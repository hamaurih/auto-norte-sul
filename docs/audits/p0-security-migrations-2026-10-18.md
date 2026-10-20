# P0 — Segurança e migrations (auditoria de 18/10/2026)

**Escopo:** Supabase de produção `pzwjbitjersngordgcsh` e repositório
`hamaurih/auto-norte-sul` no commit `85f832f616c4ba07195da447e47c8d1dbf3626c2`.

## Evidências atuais
- **202** versões aplicadas/registradas no histórico remoto.
- **140** arquivos locais de migrations, **138** versões locais únicas.
- **39** versões coincidem; **163** existem no histórico remoto mas não como
  timestamp de arquivo; **99** versões locais únicas não constam no histórico remoto.
- Versões duplicadas no GitHub: `20260828000005`, `20260909023000`.
- Branch Supabase `main`: metadado `MIGRATIONS_FAILED`. Banco permanece
  `ACTIVE_HEALTHY`; não supor que todos os schemas recentes tenham falhado.
- **0** tabelas base sem RLS em `public`.
- **61** funções `SECURITY DEFINER` em `public`: **0** executáveis
  pelos papéis `anon` e `authenticated` conforme catálogo de privilégios.
- **2** tabelas com RLS e nenhuma policy: `bling_order_sync_jobs` e
  `bling_webhook_events`. Isto é deny-by-default, mas é necessário comprovar
  que workers privilegiados tratam corretamente a fila/webhooks.
- Extensão `pg_net` instalada em `public` — aviso de segurança; não
  alterar sem mapear dependências de scheduler.

## Avaliação
Não é seguro aplicar `supabase db push`, `migration repair`, renomear versões,
apagar histórico, reaplicar migrations ou transferir a extensão neste estado.
Divergência de timestamps **não implica** ausência de cada alteração no schema:
pode refletir migrations aplicadas pelo dashboard/serviço e scripts
posteriormente consolidados sob outros nomes.

## Execução segura
1. Gerar snapshot/backup verificável do projeto; testar restauração isolada.
2. Exportar histórico remoto completo (somente versões, sem credenciais).
3. Executar `node scripts/check-migration-history.mjs <arquivo.json>` para
   produzir comparação reproduzível. Os testes do detector são
   `node --test tests/migration-history.test.mjs`.
4. Buscar SQL original/DDL e checksums das 163 versões sem correspondência.
5. Relacionar cada arquivo não registrado ao DDL efetivamente presente
   no banco. Mapear dependências/ordem antes de propor baseline ou repair.
6. Executar `supabase/tests/p0_security_readonly_audit.sql` em modo
   somente leitura; comparar resultados e avaliar `search_path`,
   proprietário, ACL e dependências de cada RPC privilegiada.
7. Homologar acesso real com tokens **sintéticos** dos papéis
   vendedor, gerente, anon e usuário sem associação, garantindo
   isolamento de tenant e negação de operações indevidas.
8. Somente após evidência de equivalência e rollback, propor migração
   corretiva independente; nenhuma correção automática em produção.

## Critério de aceite
Migrations reconciliadas com prova de equivalência do schema; 0 acessos
indevidos; testes por papel e multi-tenant aprovados; status de branch
compreendido/corrigido; backup restaurável; aprovação registrada.

**Decisão atual: P0 EM EXECUÇÃO / NÃO HOMOLOGADO.**


## Atualização da investigação — 19/10/2026

- Os quatro gates do PR #62 concluíram com `success` no commit `75dffaab549f98c7d0cee49668defa99d1af09ff`.
- A tabela `supabase_migrations.schema_migrations` contém uma coluna `statements` com SQL não vazio em **todas as 202 entradas**. É possível recuperar conteúdo e checksums do banco original, mas é necessário conferir sigilo e fidelidade antes de publicar qualquer SQL. Nenhuma migration foi reparada ou reaplicada.
- As duas tabelas de fila Bling com RLS sem policies têm `SELECT` e `INSERT` negados tanto a `anon` quanto a `authenticated`. `service_role` possui `SELECT`; testar o worker real separadamente.
- Os 61 `SECURITY DEFINER` em `public` continuam com 0 permissões de `EXECUTE` a `anon` e `authenticated`, segundo `has_function_privilege`.
- `MIGRATIONS_FAILED` persiste na metadata de branch, apesar de `ACTIVE_HEALTHY` para o banco.
- **Fase 1 NÃO aprovada** até equivalência de DDL, backup/restore isolado e autenticação de perfis/tenants efetivamente testados. CI verde não substitui esses testes.

### Consulta reprodutível: disponibilidade do SQL remoto

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE coalesce(array_length(statements,1),0)>0) AS com_sql,
       count(*) FILTER (WHERE coalesce(array_length(statements,1),0)=0) AS sem_sql
FROM supabase_migrations.schema_migrations;
```

Resultado observado: `total=202, com_sql=202, sem_sql=0`.

### Dependências do aceite pendente

1. Exportação **privada** das 202 entradas SQL e hashes; classificação de instruções perigosas/sensíveis; comparação dos scripts por conteúdo e ordem de execução.
2. Snapshot/backup completo, seguido de restauração em ambiente realmente isolado; o tenant demo no mesmo banco não conta.
3. Execução real de regressão de RLS com identidades autenticadas sintéticas em instância isolada, incluindo todos os perfis relevantes.
4. Diagnóstico na infraestrutura do status `MIGRATIONS_FAILED`, sem adulterar `schema_migrations`.
