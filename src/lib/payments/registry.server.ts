import type { PaymentProviderAdapter } from "./types";

type AdapterFactory = (credentials: Record<string, string>) => PaymentProviderAdapter;

const factories = new Map<string, AdapterFactory>();

export function registerPaymentAdapter(key: string, factory: AdapterFactory): void {
  if (factories.has(key)) throw new Error(`Payment adapter already registered: ${key}`);
  factories.set(key, factory);
}

export function createPaymentAdapter(
  key: string,
  credentials: Record<string, string>,
): PaymentProviderAdapter {
  const factory = factories.get(key);
  if (!factory) throw new Error(`Payment adapter is not installed: ${key}`);
  return factory(credentials);
}

export function registeredPaymentAdapters(): string[] {
  return [...factories.keys()].sort();
}
