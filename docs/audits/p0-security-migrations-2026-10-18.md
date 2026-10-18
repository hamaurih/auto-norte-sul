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
