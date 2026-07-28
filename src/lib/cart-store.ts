import { useEffect, useState } from "react";

export interface CartItem {
  productId: string;
  sku: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  unitPrice: number; // resolved (B2C or B2B) at time of add
  quantity: number;
}

const KEY = "nsa_cart_v1";

function read(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function write(items: CartItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("nsa:cart"));
}

export const cartStore = {
  get: read,
  add(item: Omit<CartItem, "quantity">, qty = 1) {
    const items = read();
    const idx = items.findIndex((i) => i.productId === item.productId);
    if (idx >= 0) items[idx].quantity += qty;
    else items.push({ ...item, quantity: qty });
    write(items);
  },
  setQty(productId: string, qty: number) {
    const items = read()
      .map((i) => (i.productId === productId ? { ...i, quantity: Math.max(1, qty) } : i))
      .filter((i) => i.quantity > 0);
    write(items);
  },
  remove(productId: string) {
    write(read().filter((i) => i.productId !== productId));
  },
  clear() {
    write([]);
  },
};

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  useEffect(() => {
    setItems(read());
    const on = () => setItems(read());
    window.addEventListener("nsa:cart", on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener("nsa:cart", on);
      window.removeEventListener("storage", on);
    };
  }, []);
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const count = items.reduce((s, i) => s + i.quantity, 0);
  return { items, subtotal, count };
}
