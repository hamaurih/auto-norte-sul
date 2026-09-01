const encoder = new TextEncoder();

function requiredKey(): string {
  // Prefer a dedicated key. The service-role key is a server-only fallback so
  // existing deployments can save credentials before the dedicated variable is added.
  const value = process.env.INTEGRATION_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value || value.length < 32) {
    throw new Error(
      "Nenhuma chave server-only disponível para proteger credenciais de integração.",
    );
  }
  return value;
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const decoded = Buffer.from(value, "base64url");
  const buffer = new ArrayBuffer(decoded.byteLength);
  const bytes = new Uint8Array(buffer);
  bytes.set(decoded);
  return bytes;
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
