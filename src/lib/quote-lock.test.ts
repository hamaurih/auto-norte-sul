import { describe, expect, it } from "bun:test";
import { isQuoteCommerciallyLocked } from "./quote-lock";

describe("isQuoteCommerciallyLocked", () => {
  it("permite editar orçamento em rascunho não enviado", () => {
    expect(isQuoteCommerciallyLocked({ document_type: "orcamento", status: "rascunho", sent_at: null })).toBe(false);
  });

  it("bloqueia proposta enviada", () => {
    expect(
      isQuoteCommerciallyLocked({ document_type: "proposta", status: "enviado", sent_at: "2026-09-08T00:00:00Z" }),
    ).toBe(true);
  });

  it("bloqueia proposta em negociação", () => {
    expect(isQuoteCommerciallyLocked({ document_type: "proposta", status: "em_negociacao", sent_at: null })).toBe(true);
  });

  it("bloqueia proposta aprovada", () => {
    expect(isQuoteCommerciallyLocked({ document_type: "proposta", status: "aprovado", sent_at: null })).toBe(true);
  });

  it("bloqueia proposta recusada", () => {
    expect(isQuoteCommerciallyLocked({ document_type: "proposta", status: "recusado", sent_at: null })).toBe(true);
  });

  it("bloqueia documento expirado", () => {
    expect(isQuoteCommerciallyLocked({ document_type: "orcamento", status: "expirado", sent_at: null })).toBe(true);
  });

  it("bloqueia documento convertido", () => {
    expect(isQuoteCommerciallyLocked({ document_type: "orcamento", status: "convertido", sent_at: null })).toBe(true);
  });

  it("bloqueia orçamento rascunho já enviado", () => {
    expect(
      isQuoteCommerciallyLocked({ document_type: "orcamento", status: "rascunho", sent_at: "2026-09-01T10:00:00Z" }),
    ).toBe(true);
  });
});
