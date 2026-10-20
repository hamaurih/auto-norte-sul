import { useEffect,useState } from "react";
import { cartAnalyticsConsent,setCartAnalyticsConsent } from "@/lib/cart-store";
/** Minimal first-party choice: no tracking before the visitor opts in. */
export function CartAnalyticsConsent(){
 const [choice,setChoice]=useState<string|null>("denied");
 useEffect(()=>{setChoice(cartAnalyticsConsent());const on=()=>setChoice(cartAnalyticsConsent());window.addEventListener("nsa:analytics-consent",on);return()=>window.removeEventListener("nsa:analytics-consent",on);},[]);
 if(choice!==null)return null;
 return <aside role="region" aria-label="Privacidade da loja" className="fixed bottom-4 left-4 right-4 z-[100] mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-900 shadow-xl">
  <p className="font-semibold">Privacidade no e-commerce</p>
  <p className="mt-1 text-slate-600">Podemos utilizar dados sem identificação direta de atividade do carrinho para entender desistências e melhorar a loja? Não coletamos dados de cartão, produtos individuais ou identificação pessoal nesta análise.</p>
  <div className="mt-3 flex gap-2"><button className="rounded-lg bg-slate-950 px-4 py-2 font-bold text-white" onClick={()=>setCartAnalyticsConsent(true)}>Permitir análise</button><button className="rounded-lg border px-4 py-2 font-bold" onClick={()=>setCartAnalyticsConsent(false)}>Não permitir</button></div>
 </aside>;
}
