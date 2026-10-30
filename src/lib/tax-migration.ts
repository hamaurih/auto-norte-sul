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
