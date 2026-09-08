import { describe, expect, it } from "bun:test";
import { isQuoteCommerciallyLocked } from "../src/lib/quote-lock";

describe("isQuoteCommerciallyLocked", () => {
  it("orçamento rascunho não enviado é editável", () => {
    expect(isQuoteCommerciallyLocked({ document_type: "orcamento", status: "rascunho", sent_at: null })).toBe(false);
  });

  it("proposta enviada é bloqueada", () => {
    expect(
      isQuoteCommerciallyLocked({ document_type: "proposta", status: "enviado", sent_at: "2026-09-08T00:00:00Z" }),
    ).toBe(true);
  });

  it("proposta em negociação é bloqueada", () => {
    expect(isQuoteCommerciallyLocked({ document_type: "proposta", status: "em_negociacao", sent_at: null })).toBe(true);
  });

  it("proposta aprovada é bloqueada", () => {
    expect(isQuoteCommerciallyLocked({ document_type: "proposta", status: "aprovado", sent_at: null })).toBe(true);
  });

  it("proposta recusada é bloqueada", () => {
    expect(isQuoteCommerciallyLocked({ document_type: "proposta", status: "recusado", sent_at: null })).toBe(true);
  });

  it("orçamento expirado é bloqueado", () => {
    expect(isQuoteCommerciallyLocked({ document_type: "orcamento", status: "expirado", sent_at: null })).toBe(true);
  });

  it("proposta convertida é bloqueada", () => {
    expect(isQuoteCommerciallyLocked({ document_type: "proposta", status: "convertido", sent_at: null })).toBe(true);
  });

  it("orçamento rascunho já enviado é bloqueado", () => {
    expect(
      isQuoteCommerciallyLocked({ document_type: "orcamento", status: "rascunho", sent_at: "2026-09-01T10:00:00Z" }),
    ).toBe(true);
  });

  it("nova revisão em rascunho é editável", () => {
    expect(
      isQuoteCommerciallyLocked({ document_type: "orcamento", status: "rascunho", sent_at: null }),
    ).toBe(false);
  });
});
