# Migração IBS/CBS por produto · Norte Sul

Rota `/admin/migracao-tributaria`, acesso administrativo e permissão fiscal já
existentes. Endpoint somente leitura autenticado, autorizado para owner/admin e
filtrado por tenant. Busca todo o catálogo não excluído (inclusive inativos), em
páginas ordenadas de 500 produtos e 500 perfis, sem corte no limite do Supabase.
Nenhuma alteração de checkout, NF-e, preços persistidos ou sincronização Bling.

## Classificação e contagens

O vínculo é `products.id = product_fiscal_profiles.product_id`, por tenant.
NCM de oito dígitos e taxas válidas são obrigatórios; ausência gera pendência,
nunca classificação por nome ou uma taxa única para todo o catálogo.
CEST prefixo 01 identifica autopeças; CST PIS e Cofins 04 identificam revenda
monofásica aprovada (zero), sem inferir o enquadramento federal apenas do CEST.
CST ICMS 60 ou CSOSN 500 indica ST anterior: não cobrar novamente na revenda PB.
Demais produtos usam ICMS/PIS/Cofins individuais do perfil aprovado.

O resumo no topo conta total, calculáveis, pendentes, CEST 01 e monofásicos.
Médias simples por produto calculável, uma unidade por item: percentual e R$
hoje/2027. Sem ponderação por vendas. Filtros e paginação visual (20 por página)
não alteram as médias; parâmetros e ajustes individuais alteram. Não há dados
reais do catálogo versionados: contagens são obtidas na sessão autenticada.

## Premissas de planejamento de 29/10/2026

- Balcão/online PB: 20% para autopeça com ICMS próprio; zero de ICMS na saída
  quando o perfil indica ST anterior. ST da entrada pode compor o custo cadastrado.
- Online B2C outro estado: 12% + max(interna destino − 12%, 0) + FCP.
- B2B outro estado: preço B2B, 12%; ST apenas para CEST 01 com protocolo confirmado.
  ST aproximada = max((1 + MVA/100) × (interna + FCP) − 12%, 0).
  Sem MVA, o produto fica pendente. Sem preço B2B, não adota preço B2C silenciosamente.
- UF: 27 destinos selecionáveis. Interna, FCP e MVA são parâmetros explícitos,
  com ajustes por produto, pois dependem da mercadoria/operação e da legislação.
  Trocar UF não afirma uma taxa legal automaticamente. Ajustes ficam em memória.
- 2026: teste CBS 0,9% + IBS 0,1%, exibido à parte, não somado automaticamente
  à carga atual em razão de dispensa/compensação.
- 2027: CBS geral 11,2% + IBS destino 0,1%, sem redução de 60% para autopeças;
  substitui PIS/Cofins, mantendo ICMS/DIFAL/ST durante a transição. Os 11,2% são
  premissa solicitada, não promessa de alíquota legal definitiva.
- Split Payment: segrega somente CBS/IBS (11,3% do preço de referência), mostra
  retenção na venda e depósito = preço − segregação. Também mostra saldo após
  reserva do ICMS/DIFAL/ST. Não soma novamente o imposto ao cenário 2027.
- IPI: revenda nacional não industrial não calcula IPI. Importador/industrial
  exige análise própria; nenhuma alíquota de IPI é inventada.

Cálculos são estimativas sobre o preço de referência cadastrado, com reserva
proporcional. Não são apuração fiscal: não implementam bases legais completas,
créditos, base dupla, frete, regime Simples, exceções ou cronograma obrigatório de
Split Payment. Cada cenário exibe taxa e valor; em mobile, os três permanecem lado
a lado com rolagem horizontal. Valores monetários arredondados para centavos.

## Margem, preço e alertas

Lucro bruto = preço − custo médio; lucro após impostos = lucro bruto − reserva.
Percentual consumido = reserva 2027 / lucro bruto positivo. Custo ausente não vira
zero. Preço para preservar o lucro atual = (preço − reserva atual) / (1 − taxa 2027).
Não considera outros custos operacionais. Alteração de alíquota gera alerta em
pontos percentuais, variação relativa quando a taxa atual é positiva e diferença
em reais por unidade. Não há alerta artificial quando a taxa não varia.

## Fontes

- [SEFAZ PB: autopeças / protocolos ST](https://www.sefaz.pb.gov.br/legislacao/99-regulamentos/anexos-icms/8975-produtos-substituicao-tributaria-9)
- [Lei 10.485/2002: anexos I/II e revenda](https://www.planalto.gov.br/ccivil_03/leis/2002/l10485.htm)
- [Receita Federal: teste 2026 e transição 2027–2033](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/reforma-tributaria-do-consumo/entenda)

Flag `tax_migration_preview` preservada: false oculta; true demonstração;
"effective" permite somente UI efetiva após 01/01/2027, 00h Brasília. Nunca autoriza
cobrança. Checklist mantido em `tax-migration-checklist:v1:<user-id>` no navegador.

Validação de cálculo: `node --experimental-strip-types --test tests/tax-product-scenarios.test.ts`.
Build de produção: `NITRO_PRESET=vercel npm run build` (preset usado pelo CI).
