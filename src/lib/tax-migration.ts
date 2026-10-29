/** Feature flag: false hides the page; true previews 2026; "effective" allows
 * effective UI only from 2027. NEVER authorizes checkout or ERP charging.
 * Change this constant deliberately when enabling the future UI mode.
 */
export const tax_migration_preview: boolean | "effective" = true;
export const TAX_GO_LIVE = Date.parse("2027-01-01T00:00:00-03:00");

export function taxMigrationMode(now: number, flag: boolean | "effective" = tax_migration_preview) {
  if (!flag) return "hidden";
  return flag === "effective" && now >= TAX_GO_LIVE ? "effective" : "demo";
}

/** Simplified additive scenario, without credits or replacement of current taxes. */
export function simulateTaxPrice(base: number) {
  if (!Number.isFinite(base) || base < 0 || base > 1_000_000_000) return null;
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const cbs2026 = round(base * 0.009);
  const ibs2026 = round(base * 0.001);
  const cbs2027 = round(base * 0.113);
  return {
    cbs2026,
    ibs2026,
    cbs2027,
    total2026: round(base + cbs2026 + ibs2026),
    total2027: round(base + cbs2027),
  };
}
