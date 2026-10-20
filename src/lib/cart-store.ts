import { useEffect, useState } from "react";
import { recordStorefrontCart } from "@/lib/storefront-cart-analytics.functions";
import { activeTenantSlug } from "@/integrations/supabase/tenant";

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

const ANALYTICS_CONSENT_KEY="nsa_analytics_consent";
const CART_SESSION_KEY="nsa_cart_session_v1";
function trackingSession():string {
  let id=localStorage.getItem(CART_SESSION_KEY);
  if(!id){id=crypto.randomUUID();localStorage.setItem(CART_SESSION_KEY,id);}
  return id;
}
function trackCart(items:CartItem[],event:"cart_updated"|"checkout_started"|"order_submitted"|"cleared") {
  if(typeof window==="undefined"||localStorage.getItem(ANALYTICS_CONSENT_KEY)!=="granted") return;
  try {
    void recordStorefrontCart({data:{
      storefrontSlug:activeTenantSlug(),sessionId:trackingSession(),event,
      itemsCount:items.reduce((n,x)=>n+x.quantity,0),
      estimatedTotal:items.reduce((n,x)=>n+x.unitPrice*x.quantity,0),consent:true
    }}).catch(()=>undefined);
  }catch{ /* Analytics must never block checkout */ }
}
export function setCartAnalyticsConsent(allowed:boolean){
  if(typeof window==="undefined") return;
  localStorage.setItem(ANALYTICS_CONSENT_KEY,allowed?"granted":"denied");
  if(allowed) trackCart(read(),"cart_updated");
  window.dispatchEvent(new Event("nsa:analytics-consent"));
}
export function resetCartAnalyticsConsent(){
  if(typeof window==="undefined")return;
  localStorage.removeItem(ANALYTICS_CONSENT_KEY);
  window.dispatchEvent(new Event("nsa:analytics-consent"));
}
export function cartAnalyticsConsent(){
  if(typeof window==="undefined")return null;
  return localStorage.getItem(ANALYTICS_CONSENT_KEY);
}
export function markStorefrontCheckoutStarted(){trackCart(read(),"checkout_started");}
export function markStorefrontOrderSubmitted(){trackCart(read(),"order_submitted");}

function write(items: CartItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("nsa:cart"));
  trackCart(items,items.length?"cart_updated":"cleared");
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
