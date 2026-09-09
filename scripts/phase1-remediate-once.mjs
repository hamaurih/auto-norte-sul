import { readFileSync, writeFileSync } from "node:fs";

function edit(path, transform) {
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`${path}: patch produced no changes`);
  writeFileSync(path, after);
  console.log(`patched ${path}`);
}

function replaceExact(source, oldText, newText, label) {
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error(`${label}: expected text not found`);
  if (source.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`${label}: expected text occurs more than once`);
  }
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

function replaceRegex(source, regex, replacement, label, expectedCount = 1) {
  const matches = [...source.matchAll(regex)];
  if (matches.length !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} match(es), found ${matches.length}`);
  }
  return source.replace(regex, replacement);
}

// 1) Catalog sanitation: canonical tenant membership is the only role source.
edit("src/lib/saneamento.functions.ts", (input) => {
  let s = replaceExact(
    input,
    `type Role = "admin" | "gerente" | "vendedor" | "staff";\n\nasync function assertRoles(sb: any, userId: string, roles: Role[]) {\n  const { data } = await sb.from("user_roles").select("role").eq("user_id", userId);\n  if (!(data ?? []).some((r: { role: string }) => roles.includes(r.role as Role))) {\n    throw new Error("Forbidden");\n  }\n}\n`,
    `type Role = "owner" | "admin" | "manager";\n\nasync function assertRoles(sb: any, userId: string, tenantId: string, roles: Role[]) {\n  const { data, error } = await sb\n    .from("tenant_memberships")\n    .select("role")\n    .eq("tenant_id", tenantId)\n    .eq("user_id", userId)\n    .eq("active", true)\n    .maybeSingle();\n  if (error) throw new Error(error.message);\n  if (!data?.role || !roles.includes(data.role as Role)) throw new Error("Forbidden");\n}\n`,
    "saneamento role guard",
  );
  const callRegex = /assertRoles\(context\.supabase, context\.userId, \["admin", "gerente"\]\)/g;
  const callCount = [...s.matchAll(callRegex)].length;
  if (callCount < 1) throw new Error("saneamento role calls: none found");
  s = s.replace(callRegex, 'assertRoles(context.supabase, context.userId, context.tenantId, ["owner", "admin", "manager"])');
  if (/\.from\(\s*["']user_roles["']\s*\)/.test(s)) throw new Error("saneamento still reads user_roles");
  return s;
});

// 2) User management: remove the compatibility path that could repopulate user_roles.
edit("src/lib/user-management.functions.ts", (input) => {
  let s = replaceExact(
    input,
    'const internalLegacyRoles = ["admin", "gerente", "vendedor"] as const;\n',
    "",
    "user management legacy role constant",
  );
  s = replaceRegex(
    s,
    /\nfunction legacyRoleForSystemRole\(role: SystemRole\): "admin" \| "gerente" \| "vendedor" \| "cliente" \{[\s\S]*?\n\}\n\nfunction systemRoleForTenantRole/g,
    "\nfunction systemRoleForTenantRole",
    "legacyRoleForSystemRole",
  );
  s = replaceRegex(
    s,
    /\n  \/\/ Compatibility for the legacy admin created before tenant memberships were[\s\S]*?\n  return upgraded as TenantMembership;\n/g,
    '\n  throw new Error("Somente administradores ativos podem gerenciar usuários.");\n',
    "legacy admin membership upgrade",
  );
  s = replaceRegex(
    s,
    /\nasync function syncLegacyRole\([\s\S]*?\n\}\n\nasync function savePermissions/g,
    "\nasync function savePermissions",
    "syncLegacyRole function",
  );
  const legacyCallRegex = /^\s*await syncLegacyRole\([^\n]+\);\n/gm;
  const legacyCalls = [...s.matchAll(legacyCallRegex)].length;
  if (legacyCalls !== 2) throw new Error(`syncLegacyRole calls: expected 2, found ${legacyCalls}`);
  s = s.replace(legacyCallRegex, "");
  if (/\.from\(\s*["']user_roles["']\s*\)/.test(s)) throw new Error("user management still reads user_roles");
  if (/syncLegacyRole|legacyRoleForSystemRole|internalLegacyRoles/.test(s)) throw new Error("user management legacy helpers remain");
  return s;
});

// 3) Users admin route: owner/admin from active tenant only.
edit("src/routes/_authenticated/admin.usuarios.tsx", (input) => {
  let s = replaceExact(
    input,
    'import { supabase } from "@/integrations/supabase/client";\n',
    "",
    "users route Supabase client import",
  );
  s = replaceExact(
    s,
    `  beforeLoad: async () => {\n    const { data: userRes } = await supabase.auth.getUser();\n    if (!userRes.user) throw redirect({ to: "/auth" });\n\n    const context = await fetchAccessContext();\n    const tenant = activeTenant(context);\n    const tenantAdmin = Boolean(tenant && ["owner", "admin"].includes(tenant.role));\n    const legacyAdmin = await supabase\n      .from("user_roles")\n      .select("role")\n      .eq("user_id", userRes.user.id)\n      .then(({ data }) => (data ?? []).some((item) => item.role === "admin"));\n    if (!tenantAdmin && !legacyAdmin) throw redirect({ to: "/admin" });\n  },`,
    `  beforeLoad: async () => {\n    const context = await fetchAccessContext();\n    if (!context.user_id) throw redirect({ to: "/auth" });\n    const tenant = activeTenant(context);\n    if (!tenant || !["owner", "admin"].includes(tenant.role)) throw redirect({ to: "/admin" });\n  },`,
    "users route guard",
  );
  if (/\.from\(\s*["']user_roles["']\s*\)/.test(s)) throw new Error("users route still reads user_roles");
  return s;
});

// 4) Sellers admin route: owner/admin/manager from active tenant only.
edit("src/routes/_authenticated/admin.vendedores.tsx", (input) => {
  let s = replaceExact(
    input,
    'import { supabase } from "@/integrations/supabase/client";\n',
    'import { activeTenant, fetchAccessContext } from "@/lib/access";\n',
    "sellers route access import",
  );
  s = replaceExact(
    s,
    `  beforeLoad: async () => {\n    const { data: userRes } = await supabase.auth.getUser();\n    if (!userRes.user) throw redirect({ to: "/auth" });\n    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userRes.user.id);\n    const isStaff = (roles ?? []).some((r) => r.role === "admin" || r.role === "gerente");\n    if (!isStaff) throw redirect({ to: "/" });\n  },`,
    `  beforeLoad: async () => {\n    const context = await fetchAccessContext();\n    if (!context.user_id) throw redirect({ to: "/auth" });\n    const tenant = activeTenant(context);\n    if (!tenant || !["owner", "admin", "manager"].includes(tenant.role)) throw redirect({ to: "/" });\n  },`,
    "sellers route guard",
  );
  if (/\.from\(\s*["']user_roles["']\s*\)/.test(s)) throw new Error("sellers route still reads user_roles");
  return s;
});

// 5) Bling runtime config: ERP source-of-truth flags are deprecated DB columns,
// constrained false by migration, and must not be mutable from application code.
edit("src/lib/bling.functions.ts", (input) => {
  let s = input;
  for (const line of [
    "    source_products?: boolean;\n",
    "    source_stock?: boolean;\n",
    "    source_price_b2c?: boolean;\n",
    '      "source_products",\n',
    '      "source_stock",\n',
    '      "source_price_b2c",\n',
  ]) {
    s = replaceExact(s, line, "", `bling legacy flag ${line.trim()}`);
  }
  if (/source_products|source_stock|source_price_b2c/.test(s)) throw new Error("Bling runtime still references legacy source flags");
  return s;
});

// 6) Bling admin route: canonical tenant admin guard; remove obsolete toggles.
edit("src/routes/_authenticated/admin.ecossistema.bling.tsx", (input) => {
  let s = replaceExact(
    input,
    'import { supabase } from "@/integrations/supabase/client";\n',
    'import { supabase } from "@/integrations/supabase/client";\nimport { activeTenant, fetchAccessContext } from "@/lib/access";\n',
    "Bling route access import",
  );
  s = replaceExact(
    s,
    `  beforeLoad: async () => {\n    const { data: userRes } = await supabase.auth.getUser();\n    if (!userRes.user) throw redirect({ to: "/auth" });\n    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userRes.user.id);\n    const isAdmin = (roles ?? []).some((r) => r.role === "admin");\n    if (!isAdmin) throw redirect({ to: "/admin" });\n  },`,
    `  beforeLoad: async () => {\n    const context = await fetchAccessContext();\n    if (!context.user_id) throw redirect({ to: "/auth" });\n    const tenant = activeTenant(context);\n    if (!tenant || !["owner", "admin"].includes(tenant.role)) throw redirect({ to: "/admin" });\n  },`,
    "Bling route guard",
  );
  s = replaceRegex(
    s,
    /^\s*<Toggle label="Bling é fonte principal de produtos"[^\n]*\n\s*<Toggle label="Bling é fonte principal de estoque"[^\n]*\n\s*<Toggle label="Bling é fonte principal de preço B2C"[^\n]*\n/gm,
    `              <Alert>\n                <AlertDescription>\n                  O ERP Norte Sul é a fonte oficial de produtos, estoque e preço B2C. O Bling opera somente como conector externo.\n                </AlertDescription>\n              </Alert>\n`,
    "Bling source-of-truth toggles",
  );
  if (/\.from\(\s*["']user_roles["']\s*\)/.test(s)) throw new Error("Bling route still reads user_roles");
  if (/source_products|source_stock|source_price_b2c/.test(s)) throw new Error("Bling route still references legacy source flags");
  return s;
});

console.log("PHASE1_REMEDIATION_PATCH_OK");
