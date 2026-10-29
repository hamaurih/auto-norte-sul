/** Informational assumptions supplied for PB on 2026-10-29. Rates are percentage points. */
export type TaxProfile = {
  ncm: string;
  cest: string | null;
  icms_cst: string | null;
  icms_csosn: string | null;
  icms_rate: number;
  pis_cst: string | null;
  cofins_cst: string | null;
  pis_rate: number;
  cofins_rate: number;
};
export type TaxProduct = {
  id: string;
  name: string;
  sku: string;
  price_b2c: number;
  price_b2b: number | null;
  average_cost: number | null;
  profile: TaxProfile | null;
};
export type Channel = "counter" | "online-pb" | "b2c" | "b2b";
export type TaxOptions = {
  channel: Channel;
  uf: string;
  internalRate: number;
  povertyRate: number;
  protocol: boolean;
  mva: number | null;
};
export const UFS =
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function classifyProduct(p: TaxProduct) {
  const f = p.profile;
  if (!f || !/^\d{8}$/.test(f.ncm.replace(/\D/g, ""))) return null;
  const autoParts = (f.cest ?? "").replace(/\D/g, "").startsWith("01");
  const monophase = f.pis_cst === "04" && f.cofins_cst === "04";
  const prepaidST = f.icms_cst === "60" || f.icms_csosn === "500";
  // CEST alone does not establish the federal monophase regime: use the approved CST.
  if (
    ![f.icms_rate, f.pis_rate, f.cofins_rate].every((n) => Number.isFinite(n) && n >= 0 && n <= 100)
  )
    return null;
  return {
    autoParts,
    monophase,
    prepaidST,
    label: `${autoParts ? "Autopeças CEST 01" : "Perfil fiscal individual"} · ${monophase ? "revenda monofásica" : "PIS/Cofins do perfil"} · ${prepaidST ? "ST recolhida anteriormente" : "ICMS próprio"}`,
  };
}
export function simulateProduct(p: TaxProduct, o: TaxOptions) {
  const c = classifyProduct(p),
    f = p.profile;
  if (!c || !f) return { pending: "NCM/perfil fiscal ausente ou inválido" } as const;
  const interstate = o.channel === "b2c" || o.channel === "b2b";
  if (
    !UFS.includes(o.uf) ||
    (interstate && o.uf === "PB") ||
    ![o.internalRate, o.povertyRate].every((n) => Number.isFinite(n) && n >= 0 && n <= 100)
  )
    return { pending: "Revise UF destino, alíquota interna e FCP" } as const;
  const price = o.channel === "b2b" ? p.price_b2b : p.price_b2c;
  if (price === null || !Number.isFinite(price) || price < 0)
    return { pending: "Preço do canal não cadastrado" } as const;
  const icms = interstate ? 12 : c.prepaidST ? 0 : c.autoParts ? 20 : f.icms_rate;
  const difal = o.channel === "b2c" ? Math.max(0, o.internalRate - 12) + o.povertyRate : 0;
  const needsST = o.channel === "b2b" && c.autoParts && o.protocol;
  if (needsST && (o.mva === null || !Number.isFinite(o.mva) || o.mva < 0 || o.mva > 1000))
    return { pending: "Informe MVA para estimar ST do protocolo" } as const;
  const st = needsST ? Math.max(0, (1 + o.mva! / 100) * (o.internalRate + o.povertyRate) - 12) : 0;
  const federal = c.monophase ? 0 : f.pis_rate + f.cofins_rate;
  const todayRate = icms + difal + st + federal;
  const futureRate = icms + difal + st + 11.2 + 0.1;
  if (futureRate >= 100 || todayRate >= 100)
    return { pending: "Carga estimada ≥ 100%; revise parâmetros" } as const;
  const today = round((price * todayRate) / 100),
    future = round((price * futureRate) / 100);
  // Split Payment segregates this product's CBS/IBS only (not ICMS/DIFAL/ST).
  const cbs = 11.2;
  const ibs = 0.1;
  const splitRate = round(cbs + ibs);
  const split = round((price * splitRate) / 100);
  const cost = p.average_cost;
  const grossProfit =
    cost !== null && Number.isFinite(cost) && cost >= 0 ? round(price - cost) : null;
  return {
    pending: null,
    classification: c,
    price,
    todayRate,
    futureRate,
    today,
    future,
    cbs,
    ibs,
    splitRate,
    split,
    deposit: round(price - split),
    netAfterTaxes: round(price - future),
    difal,
    st,
    icms,
    federal,
    delta: round(futureRate - todayRate),
    grossProfit,
    profitToday: grossProfit === null ? null : round(grossProfit - today),
    profitFuture: grossProfit === null ? null : round(grossProfit - future),
    profitConsumed:
      grossProfit !== null && grossProfit > 0 ? round((future / grossProfit) * 100) : null,
    preservePrice: round((price - today) / (1 - futureRate / 100)),
    test2026: round(price * 0.01),
  };
}
export function summarizeCatalog(
  products: TaxProduct[],
  options: TaxOptions,
  overrides: Record<string, Partial<TaxOptions>> = {},
) {
  const rows = products
    .map((p) => simulateProduct(p, { ...options, ...overrides[p.id] }))
    .filter((r) => r.pending === null);
  const count = rows.length;
  return {
    count,
    pending: products.length - count,
    today: count ? rows.reduce((s, r) => s + r.todayRate, 0) / count : null,
    future: count ? rows.reduce((s, r) => s + r.futureRate, 0) / count : null,
    retainedToday: count ? rows.reduce((s, r) => s + r.today, 0) / count : null,
    retainedFuture: count ? rows.reduce((s, r) => s + r.future, 0) / count : null,
  };
}
