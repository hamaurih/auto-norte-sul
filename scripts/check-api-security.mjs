import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(process.cwd(), "src", "routes", "api");
const allowedPublic = new Set([
  "health.ts",
  join("public", "login.ts"),
  join("public", "bling.callback.ts"),
]);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const failures = [];
for (const file of files(root).filter((file) => /\.(ts|tsx)$/.test(file))) {
  const rel = relative(root, file);
  const source = readFileSync(file, "utf8");
  if (allowedPublic.has(rel)) continue;
  if (!source.includes("requireApiAuth") && !source.includes("requireSupabaseAuth")) {
    failures.push(`${rel}: rota API sem guard de autenticação`);
  }
}

const mcp = readFileSync(join(process.cwd(), "src", "lib", "mcp", "index.ts"), "utf8");
if (!mcp.includes("auth.oauth.issuer")) {
  failures.push("MCP: OAuth obrigatório foi removido");
}

const login = readFileSync(join(root, "public", "login.ts"), "utf8");
if (!login.includes("ACCOUNT_MAX_FAILURES") || !login.includes("auth_login_attempts")) {
  failures.push("login: rate limit obrigatório ausente");
}

if (failures.length) {
  console.error("API SECURITY GATE FAILED\n" + failures.map((f) => `- ${f}`).join("\n"));
  process.exit(1);
}
console.log("API security invariants OK");
