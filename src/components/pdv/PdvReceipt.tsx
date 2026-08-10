import { brl } from "@/lib/format";
import type { PosSaleDetail } from "@/lib/pos-history.functions";

export const paymentMethodLabels: Record<string, string> = {
  cash: "Dinheiro",
  pix: "Pix",
  debit_card: "Débito",
  credit_card: "Crédito",
  store_credit: "Crediário",
  b2b_invoice: "Faturado B2B",
};

export const paymentLabel = (method: string) => paymentMethodLabels[method] ?? method;

export type ReceiptCompany = {
  legal_name: string | null;
  trade_name: string | null;
  tax_id: string | null;
  phone: string | null;
  address: string | null;
};

const dateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export function printReceipt() {
  window.print();
}

/**
 * Comprovante térmico (80mm) renderizado no DOM e revelado apenas na impressão
 * via `window.print()` — sem dependência extra.
 */
export function PdvReceipt({
  sale,
  company,
}: {
  sale: PosSaleDetail | null;
  company: ReceiptCompany | null;
}) {
  if (!sale) return null;
  const cancelled = Boolean(sale.cancelled_at);

  return (
    <div className="pdv-receipt" aria-hidden="true">
      <div className="pdv-receipt-center">
        <strong>{company?.trade_name || company?.legal_name || "Loja"}</strong>
        {company?.legal_name && company.legal_name !== company.trade_name ? (
          <div>{company.legal_name}</div>
        ) : null}
        {company?.tax_id ? <div>CNPJ {company.tax_id}</div> : null}
        {company?.address ? <div>{company.address}</div> : null}
        {company?.phone ? <div>{company.phone}</div> : null}
      </div>
      <hr />
      <div>{cancelled ? "COMPROVANTE DE CANCELAMENTO" : "COMPROVANTE NÃO FISCAL DE VENDA"}</div>
      <div>Código: {sale.code}</div>
      <div>Data: {dateTime(sale.created_at)}</div>
      <div>Operador: {sale.operator_name || "—"}</div>
      <div>Terminal: {sale.terminal_code || "—"}</div>
      <div>Cliente: {sale.customer_name || "Consumidor não identificado"}</div>
      <hr />
      {sale.items.map((item) => (
        <div key={item.id} className="pdv-receipt-item">
          <div>
            {item.sku ? `${item.sku} · ` : ""}
            {item.name}
          </div>
          <div className="pdv-receipt-row">
            <span>
              {item.quantity} x {brl(item.unit_price)}
            </span>
            <span>{brl(item.line_total)}</span>
          </div>
        </div>
      ))}
      <hr />
      <div className="pdv-receipt-row">
        <span>Subtotal</span>
        <span>{brl(sale.subtotal)}</span>
      </div>
      <div className="pdv-receipt-row">
        <span>Desconto</span>
        <span>{brl(sale.discount_amount)}</span>
      </div>
      <div className="pdv-receipt-row">
        <strong>Total</strong>
        <strong>{brl(sale.total)}</strong>
      </div>
      <hr />
      <div>Pagamentos</div>
      {sale.payments.map((payment) => (
        <div key={payment.id} className="pdv-receipt-row">
          <span>
            {paymentLabel(payment.method)}
            {payment.installments && payment.installments > 1 ? ` ${payment.installments}x` : ""}
          </span>
          <span>{brl(payment.amount)}</span>
        </div>
      ))}
      {cancelled ? (
        <>
          <hr />
          <div>
            <strong>VENDA CANCELADA</strong>
          </div>
          <div>Data do cancelamento: {dateTime(sale.cancelled_at)}</div>
          <div>Motivo: {sale.cancel_reason || "não informado"}</div>
        </>
      ) : null}
      <hr />
      <div className="pdv-receipt-center">Documento sem valor fiscal · obrigado pela preferência</div>
    </div>
  );
}
