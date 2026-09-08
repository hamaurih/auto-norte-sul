import { describe, expect, it } from "vitest";
import { isQuoteCommerciallyLocked } from "@/lib/quotes-ui";

describe("isQuoteCommerciallyLocked", () => {
  it("permite editar rascunho de orçamento", () => {
    expect(
      isQuoteCommerciallyLocked({ document_type: "orcamento", status: "rascunho", sent_at: null }),
    ).toBe(false);
  });

  it("bloqueia proposta enviada", () => {
    expect(
      isQuoteCommerciallyLocked({
        document_type: "proposta",
        status: "enviado",
        sent_at: "2026-09-08T10:00:00Z",
      }),
    ).toBe(true);
  });

  it("bloqueia orçamento que já foi enviado mesmo sem virar proposta", () => {
    expect(
      isQuoteCommerciallyLocked({ document_type: "orcamento", status: "em_negociacao", sent_at: null }),
    ).toBe(true);
  });

  it("bloqueia documento convertido e expirado", () => {
    expect(isQuoteCommerciallyLocked({ document_type: "proposta", status: "convertido" })).toBe(true);
    expect(isQuoteCommerciallyLocked({ document_type: "orcamento", status: "expirado" })).toBe(true);
  });

  it("permite editar a nova revisão", () => {
    expect(
      isQuoteCommerciallyLocked({
        document_type: "orcamento",
        status: "rascunho",
        sent_at: null,
      }),
    ).toBe(false);
  });
});
