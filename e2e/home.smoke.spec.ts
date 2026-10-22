import { test, expect } from "@playwright/test";

test("home renders a document without an unhandled page error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBeLessThan(500);
  await expect(page.locator("body")).not.toBeEmpty();
  expect(errors).toEqual([]);
});
