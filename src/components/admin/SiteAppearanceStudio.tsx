import {useEffect,useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useServerFn} from "@tanstack/react-start";
import {toast} from "sonner";
import {getSiteAppearanceStudio,saveSiteAppearanceDraft,publishSiteAppearanceDraft} from "@/lib/site-appearance.functions";
type Draft={store_title:string;store_description:string;footer_text:string;primary_color:string;secondary_color:string;accent_color:string};
const fallback:Draft={store_title:"Norte Sul Acessórios",store_description:"Acessórios automotivos",footer_text:"",primary_color:"#1e40af",secondary_color:"#0f172a",accent_color:"#f59e0b"};
export function SiteAppearanceStudio(){
 const fetchFn=useServerFn(getSiteAppearanceStudio),saveFn=useServerFn(saveSiteAppearanceDraft),publishFn=useServerFn(publishSiteAppearanceDraft);
 const query=useQuery({queryKey:["site-appearance-studio"],queryFn:()=>fetchFn()});
 const qc=useQueryClient();
 const [form,setForm]=useState<Draft>(fallback),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false);
 useEffect(()=>{if(query.data){const input=query.data.draft??query.data.live??{};setForm({...fallback,...Object.fromEntries(Object.entries(input).filter(([,v])=>typeof v==="string"&&v!==""))});setDirty(false)}},[query.data]);
 const update=(key:keyof Draft,value:string)=>{setForm(x=>({...x,[key]:value}));setDirty(true)};
 async function save(){
  setBusy(true);try{await saveFn({data:form});await qc.invalidateQueries({queryKey:["site-appearance-studio"]});toast.success("Rascunho salvo. A loja pública ainda não foi alterada.");}catch(e){toast.error(e instanceof Error?e.message:"Erro ao salvar");}finally{setBusy(false)}
 }
 async function publish(){
  if(dirty){toast.error("Salve o rascunho antes de publicar.");return}
  if(!window.confirm("Publicar estas cores e textos no site público?"))return;
  setBusy(true);try{await publishFn();await Promise.all([qc.invalidateQueries({queryKey:["site-appearance-studio"]}),qc.invalidateQueries({queryKey:["company-profile"]})]);toast.success("Aparência publicada no site.");}catch(e){toast.error(e instanceof Error?e.message:"Erro ao publicar");}finally{setBusy(false)}
 }
 return <section className="mb-8 space-y-4 rounded-2xl border bg-white p-5 shadow-sm">
  <div><h2 className="text-xl font-black">Editor de aparência do site</h2><p className="text-sm text-slate-500">Edite, visualize, salve o rascunho e publique quando estiver aprovado. Banners e fotos são administrados abaixo.</p></div>
  {query.isError?<p role="alert" className="text-red-700">Não foi possível acessar as configurações visuais.</p>:
  <div className="grid gap-5 lg:grid-cols-2">
   <div className="space-y-3">
    {([["store_title","Título da loja"],["store_description","Descrição da loja"],["footer_text","Texto do rodapé"]] as const).map(([key,label])=><label key={key} className="block text-sm font-semibold">{label}<input className="mt-1 w-full rounded-lg border px-3 py-2" value={form[key]} maxLength={key==="store_title"?140:800} onChange={e=>update(key,e.target.value)}/></label>)}
    {([["primary_color","Cor principal"],["secondary_color","Cor secundária"],["accent_color","Cor de destaque"]] as const).map(([key,label])=><label key={key} className="flex items-center gap-3 text-sm font-semibold"><input type="color" value={form[key]} onChange={e=>update(key,e.target.value)} className="size-11 cursor-pointer"/>{label}<span className="font-mono text-xs text-slate-500">{form[key]}</span></label>)}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||query.isLoading} onClick={()=>void save()} className="rounded-lg border border-blue-700 bg-white px-4 py-2 font-bold text-blue-800 disabled:opacity-50">Salvar rascunho</button><button type="button" disabled={busy||dirty||!query.data?.draft} onClick={()=>void publish()} className="rounded-lg bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50">Publicar no site</button></div>
    <p className="text-xs text-slate-500">{dirty?"Alterações ainda não salvas":query.data?.savedAt?"Rascunho salvo em "+new Date(query.data.savedAt).toLocaleString("pt-BR"):"Configure e salve uma primeira versão."}</p>
   </div>
   <div aria-label="Prévia da identidade visual" className="overflow-hidden rounded-xl border">
    <div className="flex items-center justify-between p-4 text-white" style={{backgroundColor:form.secondary_color}}><b>{form.store_title||"Nome da loja"}</b><span>Catálogo · Ofertas</span></div>
    <div className="p-6 text-white" style={{backgroundColor:form.primary_color}}><h3 className="text-2xl font-black">{form.store_title}</h3><p className="mt-2 text-sm">{form.store_description}</p><span className="mt-4 inline-block rounded px-4 py-2 text-sm font-bold text-slate-950" style={{backgroundColor:form.accent_color}}>Ver produtos</span></div>
    <div className="border-t p-4 text-sm text-slate-500">{form.footer_text||"Rodapé da loja"}</div>
    <p className="border-t bg-slate-50 p-2 text-xs text-slate-500">Prévia ilustrativa das cores e textos. Não altera a loja até publicar.</p>
   </div>
  </div>}
 </section>;
}
