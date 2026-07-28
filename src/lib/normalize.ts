// Normalização de termos de busca para casar com aliases e nomes de produtos.
// Regras: minúsculo, sem acento, sem espaços duplicados, sem hífens (viram espaço),
// plural simples removido no final. Mantém letras/números.
export function normalizeTerm(input: string): string {
  if (!input) return "";
  let s = input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.toLowerCase();
  s = s.replace(/[-_/]+/g, " ");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  // plural simples: "faroes"/"laminas" — remove trailing "s" apenas se >3 chars e não termina em "ss"
  s = s.replace(/\b([a-z]{4,}?)s\b/g, (m, w) => (m.endsWith("ss") ? m : w));
  return s;
}
