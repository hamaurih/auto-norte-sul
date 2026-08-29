const encoder = new TextEncoder();

function requiredKey(): string {
  const value = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!value || value.length < 32) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY não configurada. Defina uma chave aleatória com pelo menos 32 caracteres no ambiente do servidor.",
    );
  }
  return value;
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

async function getKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(requiredKey()));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptIntegrationSecret(value: string): Promise<string> {
  const normalized = value.trim();
  if (!normalized) throw new Error("O segredo não pode ficar vazio.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await getKey(),
    encoder.encode(normalized),
  );
  return `v1:${toBase64Url(iv)}:${toBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptIntegrationSecret(value: string): Promise<string> {
  const [version, ivValue, encryptedValue] = value.split(":");
  if (version !== "v1" || !ivValue || !encryptedValue) {
    throw new Error("Credencial protegida em formato inválido.");
  }
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(ivValue) },
    await getKey(),
    fromBase64Url(encryptedValue),
  );
  return new TextDecoder().decode(decrypted);
}

export function isEncryptedIntegrationSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("v1:");
}
