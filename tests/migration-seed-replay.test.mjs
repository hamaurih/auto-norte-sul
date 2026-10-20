import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Mercado Pago migration does not hard-code a tenant UUID", () => {
 const sql=readFileSync("supabase/migrations/20260904230343_p2_prepare_mercado_pago_provider.sql","utf8");
 assert.match(sql,/FROM\s+public\.tenants\s+AS\s+t/i);
 assert.match(sql,/WHERE\s+t\.slug\s*=\s*'norte-sul-real'/i);
 assert.match(sql,/ON\s+CONFLICT\s*\(tenant_id,code,environment\)/i);
 assert.doesNotMatch(sql,/87fee723-b111-411e-827e-ea6e67fd29ae/i);
});
