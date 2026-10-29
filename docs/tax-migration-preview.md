# Migração IBS/CBS

Página administrativa: `/admin/migracao-tributaria`, no grupo Gestão Comercial,
restrita a administradores e à permissão fiscal existente.

Flag `tax_migration_preview` em `src/lib/tax-migration.ts`:

- `false`: oculta o atalho e retorna página não encontrada no acesso direto.
- `true` (padrão): demonstração, inclusive após 2026.
- `"effective"`: demonstração até 01/01/2027 às 00h de Brasília; depois,
  apresenta o modo “Efetivo · somente UI”.

Nenhum valor da flag autoriza cobranças. Não há comunicação com checkout,
Trier, Bling ou funções de emissão/sincronização.

O simulador soma tributos à base apenas como hipótese didática, arredondando
cada tributo para centavos. Não calcula carga tributária real, créditos ou
substituição de PIS/Cofins. O cenário 2027 contempla somente CBS.
Referência de 11,3% do TCU em 28/10/2026, sujeita à resolução do Senado:
https://portal.tcu.gov.br/imprensa/noticias/tcu-calcula-aliquota-de-referencia-de-113-para-novo-tributo-sobre-consumo

O checklist usa localStorage com chave `tax-migration-checklist:v1:<user-id>`.
É local ao navegador e usuário, não sincroniza entre dispositivos. Bloqueio de
armazenamento mostra aviso e permite marcações temporárias em memória.
