import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const runtimeFiles = [
  "src/lib/bling.functions.ts",
  "src/lib/bling-sales-export.server.ts",
  "src/lib/bling-connection-monitor.server.ts",
  "src/lib/bling-customers-cutover.functions.ts",
  "src/lib/bling-cost-recovery.functions.ts",
  "src/lib/shipping-bling-fallback.server.ts",
  "src/routes/api/public/bling.callback.ts",
];

describe("Bling JWT migration guard", () => {
  test("every Bling HTTP runtime keeps enable-jwt enabled", () => {
    for (const path of runtimeFiles) {
      const source = readFileSync(path, "utf8");
      expect(source.includes("enable-jwt")).toBe(true);
    }
  });

  test("customer cutover uses JWT on refresh and authenticated API calls", () => {
    const source = readFileSync("src/lib/bling-customers-cutover.functions.ts", "utf8");
    expect(source.includes('Accept: "1.0"')).toBe(true);
    expect(source.includes('"enable-jwt": "1"')).toBe(true);
    expect(source.includes('Authorization: `Bearer ${token}`, Accept: "application/json", "enable-jwt": "1"')).toBe(true);
  });

  test("sales export keeps JWT on token refresh and order API", () => {
    const source = readFileSync("src/lib/bling-sales-export.server.ts", "utf8");
    expect(source.includes('"enable-jwt": "1"')).toBe(true);
    expect(source.includes('Authorization: "Bearer " + token')).toBe(true);
  });
});
