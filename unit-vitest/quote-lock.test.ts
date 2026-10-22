import { describe, expect, it } from "vitest";
import { isQuoteCommerciallyLocked } from "../src/lib/quote-lock";

describe("commercial quote locking", () => {
  it("keeps an unsent draft editable", () => {
    expect(isQuoteCommerciallyLocked({ document_type: "orcamento", status: "rascunho", sent_at: null })).toBe(false);
  });
  it("locks an already sent draft", () => {
    expect(isQuoteCommerciallyLocked({ document_type: "orcamento", status: "rascunho", sent_at: "2026-10-01T10:00:00Z" })).toBe(true);
  });
});
