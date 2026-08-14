/**
 * Parser e validador de XML de NF-e (modelo 55) sem dependências externas.
 *
 * Módulo puro (sem acesso a rede, banco ou APIs de navegador): é usado pelo
 * servidor para processar o arquivo enviado e pelos testes.
 *
 * Fora de escopo nesta etapa (evolução futura): manifestação do destinatário,
 * download automático na SEFAZ e escrituração fiscal.
 */

export type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
};

const decodeEntities = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");

const localName = (name: string) => {
  const clean = name.trim();
  const idx = clean.indexOf(":");
  return idx >= 0 ? clean.slice(idx + 1) : clean;
};

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const key = localName(match[1] ?? match[3] ?? "");
    const value = match[2] ?? match[4] ?? "";
    if (key) attrs[key] = decodeEntities(value);
  }
  return attrs;
}

/** Parser XML mínimo e tolerante a namespaces, suficiente para NF-e. */
export function parseXml(source: string): XmlNode | null {
  let src = String(source ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "");

  // CDATA vira texto simples (escapado para não confundir o tokenizador)
  src = src.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, content: string) =>
    content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  );

  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  const tagRe = /<\s*(\/?)\s*([^\s/>]+)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)\s*>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(src))) {
    const between = src.slice(lastIndex, match.index);
    if (stack.length > 0 && between.trim()) {
      stack[stack.length - 1]!.text += decodeEntities(between).trim();
    }
    lastIndex = tagRe.lastIndex;

    const closing = match[1] === "/";
    const name = localName(match[2] ?? "");
    const selfClosing = match[4] === "/";

    if (closing) {
      const popped = stack.pop();
      if (!popped) return null;
      if (popped.name !== name) {
        // XML malformado: aborta em vez de adivinhar a estrutura
        return null;
      }
      continue;
    }

    const node: XmlNode = { name, attrs: parseAttrs(match[3] ?? ""), children: [], text: "" };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else if (!root) root = node;

    if (!selfClosing) stack.push(node);
  }

  if (stack.length > 0) return null;
  return root;
}

export function child(node: XmlNode | null | undefined, ...path: string[]): XmlNode | null {
  let current: XmlNode | null | undefined = node;
  for (const step of path) {
    current = current?.children.find((item) => item.name === step) ?? null;
    if (!current) return null;
  }
  return current ?? null;
}

export function childrenNamed(node: XmlNode | null | undefined, name: string): XmlNode[] {
  return (node?.children ?? []).filter((item) => item.name === name);
}

export function textOf(node: XmlNode | null | undefined, ...path: string[]): string {
  const target = path.length > 0 ? child(node, ...path) : node;
  return (target?.text ?? "").trim();
}

export function numberOf(node: XmlNode | null | undefined, ...path: string[]): number {
  const raw = textOf(node, ...path).replace(",", ".");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ===================== Chave de acesso =====================

const onlyDigits = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "");

/** Dígito verificador da chave (módulo 11, pesos 2..9). */
export function accessKeyCheckDigit(first43: string): number {
  let weight = 2;
  let sum = 0;
  for (let i = first43.length - 1; i >= 0; i -= 1) {
    sum += Number(first43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest === 0 || rest === 1 ? 0 : 11 - rest;
}

export function isValidAccessKey(value: string | null | undefined): boolean {
  const key = onlyDigits(value);
  if (key.length !== 44) return false;
  return accessKeyCheckDigit(key.slice(0, 43)) === Number(key[43]);
}

/** GTIN-8/12/13/14 com dígito verificador válido. */
export function isValidGtin(value: string | null | undefined): boolean {
  const gtin = onlyDigits(value);
  if (![8, 12, 13, 14].includes(gtin.length)) return false;
  if (/^0+$/.test(gtin)) return false;
  const digits = gtin.split("").map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  digits.reverse().forEach((digit, index) => {
    sum += digit * (index % 2 === 0 ? 3 : 1);
  });
  const expected = (10 - (sum % 10)) % 10;
  return expected === check;
}

// ===================== Extração =====================

export type NfeItem = {
  line_number: number;
  supplier_code: string | null;
  gtin: string | null;
  description: string;
  ncm: string | null;
  cfop: string | null;
  unit: string | null;
  qty: number;
  unit_value: number;
  discount_amount: number;
  freight_amount: number;
  other_amount: number;
  total_amount: number;
};

export type ParsedNfe = {
  access_key: string;
  nfe_version: string | null;
  nfe_number: number;
  nfe_series: number;
  nfe_model: string | null;
  operation_nature: string | null;
  issued_at: string | null;
  emitter_tax_id: string;
  emitter_name: string;
  emitter_trade_name: string | null;
  emitter_state_tax_id: string | null;
  emitter_address: {
    street: string | null;
    number: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
    zip_code: string | null;
    phone: string | null;
  };
  recipient_tax_id: string | null;
  recipient_name: string | null;
  total_products: number;
  total_discount: number;
  total_freight: number;
  total_invoice: number;
  items: NfeItem[];
};

export class NfeValidationError extends Error {
  readonly details: string[];
  constructor(details: string[]) {
    super(details[0] ?? "XML de NF-e inválido");
    this.name = "NfeValidationError";
    this.details = details;
  }
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function isoDate(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  // dhEmi = 2026-08-14T10:20:30-03:00 · dEmi = 2026-08-14
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00-03:00` : raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Valida a estrutura (nfeProc/NFe → infNFe), versão, chave, número, série,
 * emissão, emitente, destinatário, totais e itens. Lança
 * `NfeValidationError` com todas as mensagens encontradas.
 */
export function parseNfeXml(xml: string): ParsedNfe {
  const root = parseXml(xml);
  if (!root) throw new NfeValidationError(["Arquivo não é um XML válido ou está corrompido."]);

  const nfe = root.name === "nfeProc" ? child(root, "NFe") : root.name === "NFe" ? root : null;
  if (!nfe) {
    throw new NfeValidationError([
      "Estrutura não reconhecida: o XML deve ter raiz nfeProc ou NFe (NF-e modelo 55).",
    ]);
  }

  const infNFe = child(nfe, "infNFe");
  if (!infNFe) throw new NfeValidationError(["Bloco infNFe não encontrado no XML."]);

  const errors: string[] = [];

  const version = (infNFe.attrs["versao"] ?? "").trim() || null;
  if (!version) errors.push("Versão do layout (infNFe@versao) ausente.");
  else if (!/^4\./.test(version)) errors.push(`Versão de layout não suportada: ${version}. Use NF-e 4.x.`);

  const keyFromId = onlyDigits(infNFe.attrs["Id"] ?? "");
  const protKey = onlyDigits(textOf(child(root, "protNFe", "infProt"), "chNFe"));
  const accessKey = keyFromId.length === 44 ? keyFromId : protKey;
  if (accessKey.length !== 44) errors.push("Chave de acesso ausente ou com tamanho diferente de 44 dígitos.");
  else if (!isValidAccessKey(accessKey)) errors.push("Chave de acesso inválida (dígito verificador não confere).");
  else if (protKey && protKey.length === 44 && protKey !== accessKey) {
    errors.push("Chave do protocolo (protNFe) diferente da chave da NF-e.");
  }

  const ide = child(infNFe, "ide");
  const model = textOf(ide, "mod") || null;
  if (model && model !== "55") errors.push(`Modelo ${model} não suportado; esta importação aceita NF-e modelo 55.`);

  const number = Number(onlyDigits(textOf(ide, "nNF")));
  if (!Number.isFinite(number) || number <= 0) errors.push("Número da NF-e (nNF) ausente ou inválido.");

  const serieRaw = textOf(ide, "serie");
  const serie = Number(onlyDigits(serieRaw));
  if (!serieRaw || !Number.isFinite(serie)) errors.push("Série da NF-e (serie) ausente ou inválida.");

  const issuedAt = isoDate(textOf(ide, "dhEmi") || textOf(ide, "dEmi"));
  if (!issuedAt) errors.push("Data de emissão (dhEmi/dEmi) ausente ou inválida.");

  const emit = child(infNFe, "emit");
  const emitterTaxId = onlyDigits(textOf(emit, "CNPJ") || textOf(emit, "CPF"));
  const emitterName = textOf(emit, "xNome");
  if (!emitterTaxId || (emitterTaxId.length !== 14 && emitterTaxId.length !== 11)) {
    errors.push("CNPJ/CPF do emitente ausente ou inválido.");
  }
  if (!emitterName) errors.push("Razão social do emitente (xNome) ausente.");

  const dest = child(infNFe, "dest");
  const recipientTaxId = onlyDigits(textOf(dest, "CNPJ") || textOf(dest, "CPF")) || null;
  const recipientName = textOf(dest, "xNome") || null;
  if (!dest) errors.push("Bloco do destinatário (dest) ausente.");

  const icmsTot = child(infNFe, "total", "ICMSTot");
  if (!icmsTot) errors.push("Bloco de totais (total/ICMSTot) ausente.");
  const totalProducts = round2(numberOf(icmsTot, "vProd"));
  const totalDiscount = round2(numberOf(icmsTot, "vDesc"));
  const totalFreight = round2(numberOf(icmsTot, "vFrete"));
  const totalInvoice = round2(numberOf(icmsTot, "vNF"));
  if (icmsTot && totalInvoice <= 0) errors.push("Valor total da NF-e (vNF) ausente ou zerado.");

  const dets = childrenNamed(infNFe, "det");
  if (dets.length === 0) errors.push("Nenhum item (det) encontrado no XML.");

  const items: NfeItem[] = [];
  dets.forEach((det, index) => {
    const prod = child(det, "prod");
    const line = Number(onlyDigits(det.attrs["nItem"] ?? "")) || index + 1;
    const description = textOf(prod, "xProd");
    const qty = numberOf(prod, "qCom");
    const unitValue = numberOf(prod, "vUnCom");
    const total = round2(numberOf(prod, "vProd"));

    if (!description) errors.push(`Item ${line}: descrição (xProd) ausente.`);
    if (!(qty > 0)) errors.push(`Item ${line}: quantidade (qCom) deve ser maior que zero.`);
    if (unitValue < 0) errors.push(`Item ${line}: valor unitário (vUnCom) inválido.`);

    const gtinRaw = onlyDigits(textOf(prod, "cEAN") || textOf(prod, "cEANTrib"));

    items.push({
      line_number: line,
      supplier_code: textOf(prod, "cProd") || null,
      gtin: isValidGtin(gtinRaw) ? gtinRaw : null,
      description,
      ncm: onlyDigits(textOf(prod, "NCM")) || null,
      cfop: onlyDigits(textOf(prod, "CFOP")) || null,
      unit: textOf(prod, "uCom") || null,
      qty,
      unit_value: unitValue,
      discount_amount: round2(numberOf(prod, "vDesc")),
      freight_amount: round2(numberOf(prod, "vFrete")),
      other_amount: round2(numberOf(prod, "vOutro") + numberOf(prod, "vSeg")),
      total_amount: total,
    });
  });

  if (errors.length > 0) throw new NfeValidationError(errors);

  const enderEmit = child(emit, "enderEmit");

  return {
    access_key: accessKey,
    nfe_version: version,
    nfe_number: number,
    nfe_series: serie,
    nfe_model: model,
    operation_nature: textOf(ide, "natOp") || null,
    issued_at: issuedAt,
    emitter_tax_id: emitterTaxId,
    emitter_name: emitterName,
    emitter_trade_name: textOf(emit, "xFant") || null,
    emitter_state_tax_id: textOf(emit, "IE") || null,
    emitter_address: {
      street: textOf(enderEmit, "xLgr") || null,
      number: textOf(enderEmit, "nro") || null,
      district: textOf(enderEmit, "xBairro") || null,
      city: textOf(enderEmit, "xMun") || null,
      state: textOf(enderEmit, "UF") || null,
      zip_code: onlyDigits(textOf(enderEmit, "CEP")) || null,
      phone: onlyDigits(textOf(enderEmit, "fone")) || null,
    },
    recipient_tax_id: recipientTaxId,
    recipient_name: recipientName,
    total_products: totalProducts,
    total_discount: totalDiscount,
    total_freight: totalFreight,
    total_invoice: totalInvoice,
    items,
  };
}

export const MAX_NFE_XML_BYTES = 2 * 1024 * 1024;
