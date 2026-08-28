/**
 * format-input.ts — Máscaras e validadores para dados brasileiros.
 * UI-21: CPF, CNPJ, CEP, telefone — máscaras + validação de dígito verificador.
 */

// ─────────────────────────── CPF ───────────────────────────

export function maskCpf(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

export function validateCpf(raw: string): boolean {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (s: number) => {
    let sum = 0;
    for (let i = 0; i < s; i++) sum += parseInt(d[i]) * (s + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 || r === 11 ? 0 : r;
  };
  return calc(9) === parseInt(d[9]) && calc(10) === parseInt(d[10]);
}

// ─────────────────────────── CNPJ ───────────────────────────

export function maskCnpj(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function validateCnpj(raw: string): boolean {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (s: number) => {
    let sum = 0, pos = s - 7;
    for (let i = s; i >= 1; i--) {
      sum += parseInt(d[s - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === parseInt(d[12]) && calc(13) === parseInt(d[13]);
}

// ─────────── CPF ou CNPJ automático ─────────────

export function maskDocument(v: string): string {
  const d = v.replace(/\D/g, "");
  return d.length <= 11 ? maskCpf(d) : maskCnpj(d);
}

export function validateDocument(raw: string): { ok: boolean; type: "cpf" | "cnpj" | "invalid" } {
  const d = raw.replace(/\D/g, "");
  if (d.length === 11) return { ok: validateCpf(d), type: "cpf" };
  if (d.length === 14) return { ok: validateCnpj(d), type: "cnpj" };
  return { ok: false, type: "invalid" };
}

// ─────────────────────────── CEP ───────────────────────────

export function maskCep(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return d.replace(/(\d{5})(\d{1,3})$/, "$1-$2");
}

export async function fetchAddressByCep(
  cep: string,
): Promise<{
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
} | null> {
  const clean = cep.replace(/\D/g, "");
  if (clean.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.erro) return null;
    return data;
  } catch {
    return null;
  }
}

// ─────────────────────────── Telefone ───────────────────────────

export function maskPhone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) {
    return d
      .replace(/(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{4})(\d{1,4})$/, "$1-$2");
  }
  return d
    .replace(/(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d{1,4})$/, "$1-$2");
}
