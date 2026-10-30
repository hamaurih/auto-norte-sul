import { brl } from "@/lib/format";

export type ImmutableReceiptData = {
  id: string;
  order_id: string;
  receipt_number: number | string;
  receipt_code: string;
  issued_at: string;
  customer_snapshot: any;
  sale_snapshot: any;
  items_snapshot: any[];
  payments_snapshot: any[];
  snapshot_hash: string;
};

export type ReceiptCompanyData = {
  legal_name?: string | null;
  trade_name?: string | null;
  tax_id?: string | null;
  state_registration?: string | null;
  municipal_registration?: string | null;
  phone?: string | null;
  email?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_state?: string | null;
};

const paymentLabels: Record<string,string> = {
  pix:"PIX", cartao:"Cartão", boleto:"Boleto", cash:"Dinheiro",
  debit_card:"Cartão de débito", credit_card:"Cartão de crédito",
  store_credit:"Crediário", b2b_invoice:"Faturado B2B",
};

const paymentLabel=(value:unknown)=>{
  const key=String(value??"não informado");
  return paymentLabels[key]??key.replaceAll("_"," ");
};

export function ImmutableSaleReceipt({receipt,company}:{receipt:ImmutableReceiptData|null;company:ReceiptCompanyData|null}) {
  if(!receipt) return null;
  const sale=receipt.sale_snapshot??{};
  const customer=receipt.customer_snapshot??{};
  const items=Array.isArray(receipt.items_snapshot)?receipt.items_snapshot:[];
  const payments=Array.isArray(receipt.payments_snapshot)?receipt.payments_snapshot:[];
  const address=[company?.address_street,company?.address_number,company?.address_neighborhood,company?.address_city,company?.address_state].filter(Boolean).join(" · ");
  return <div className="pdv-receipt official-nonfiscal-receipt" aria-label="Comprovante não fiscal de venda">
    <div className="pdv-receipt-center">
      <strong>{company?.trade_name||company?.legal_name||"Norte Sul"}</strong>
      {company?.legal_name&&company.legal_name!==company.trade_name?<div>{company.legal_name}</div>:null}
      {company?.tax_id?<div>CNPJ {company.tax_id}</div>:null}
      {company?.state_registration?<div>IE {company.state_registration}</div>:null}
      {address?<div>{address}</div>:null}
      {company?.phone?<div>Tel. {company.phone}</div>:null}
    </div>
    <hr/>
    <div className="pdv-receipt-center"><strong>COMPROVANTE NÃO FISCAL DE VENDA</strong></div>
    <div>Nº do recibo: {receipt.receipt_number}</div>
    <div>Código: {receipt.receipt_code}</div>
    <div>Pedido: {String(receipt.order_id).toUpperCase()}</div>
    <div>Data/Hora: {new Date(receipt.issued_at).toLocaleString("pt-BR")}</div>
    <div>Canal: {sale.channel_code||"não informado"}</div>
    <div>Cliente: {customer.name||"Consumidor não identificado"}</div>
    {customer.document?<div>CPF/CNPJ: {customer.document}</div>:null}
    <hr/>
    {items.map((item:any,index:number)=><div key={item.order_item_id??index} className="pdv-receipt-item">
      <div>{item.sku?item.sku+" · ":""}{item.name||"Produto"}</div>
      <div className="pdv-receipt-row"><span>{Number(item.quantity??0)} x {brl(Number(item.unit_price??0))}</span><span>{brl(Number(item.line_total??0))}</span></div>
    </div>)}
    <hr/>
    <div className="pdv-receipt-row"><span>Subtotal</span><span>{brl(Number(sale.subtotal??0))}</span></div>
    <div className="pdv-receipt-row"><span>Desconto</span><span>{brl(Number(sale.discount??0))}</span></div>
    <div className="pdv-receipt-row"><span>Frete/Entrega</span><span>{brl(Number(sale.shipping??0))}</span></div>
    <div className="pdv-receipt-row"><strong>TOTAL</strong><strong>{brl(Number(sale.total??0))}</strong></div>
    <hr/>
    <div><strong>Pagamentos</strong></div>
    {payments.length?payments.map((p:any,index:number)=><div key={p.payment_id??index} className="pdv-receipt-row"><span>{paymentLabel(p.method)}{Number(p.installments??1)>1?" "+p.installments+"x":""}</span><span>{brl(Number(p.amount??0))}</span></div>):<div>Forma informada: {paymentLabel(sale.payment_method)}</div>}
    <hr/>
    <div className="pdv-receipt-center"><strong>DOCUMENTO NÃO FISCAL</strong></div>
    <div className="pdv-receipt-center">Comprovante comercial da venda. Não substitui NF-e/NFC-e quando aplicável.</div>
    <div className="pdv-receipt-center">A emissão fiscal é realizada separadamente por usuário autorizado.</div>
    <div className="pdv-receipt-center">Integridade: {receipt.snapshot_hash.slice(0,16)}…</div>
  </div>;
}
