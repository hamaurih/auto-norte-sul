import {createServerFn} from "@tanstack/react-start";
import {z} from "zod";
import {requireSupabaseAuth} from "@/integrations/supabase/tenant-auth";
import {requireTenantRole} from "@/lib/auth-guards";

const hex=z.string().regex(/^#[0-9a-fA-F]{6}$/);
const appearance=z.object({
 store_title:z.string().max(140),
 store_description:z.string().max(800),
 footer_text:z.string().max(800),
 primary_color:hex,secondary_color:hex,accent_color:hex,
});
async function authorized(context:any){
 await requireTenantRole(context.supabase,context.userId,context.tenantId,["owner","admin"]);
 const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
 return supabaseAdmin as any;
}
export const getSiteAppearanceStudio=createServerFn({method:"GET"})
 .middleware([requireSupabaseAuth]).handler(async({context})=>{
 const db=await authorized(context);
 const [live,draft]=await Promise.all([
  db.from("tenant_company_profiles").select("store_title,store_description,footer_text,primary_color,secondary_color,accent_color").eq("tenant_id",context.tenantId).maybeSingle(),
  db.from("site_appearance_drafts").select("draft,updated_at,published_at").eq("tenant_id",context.tenantId).maybeSingle()
 ]);
 if(live.error||draft.error) throw new Error("Não foi possível carregar o editor");
 return {live:live.data,draft:draft.data?.draft??null,savedAt:draft.data?.updated_at??null,publishedAt:draft.data?.published_at??null};
});
export const saveSiteAppearanceDraft=createServerFn({method:"POST"})
 .middleware([requireSupabaseAuth]).inputValidator((input:unknown)=>appearance.parse(input))
 .handler(async({context,data})=>{
 const db=await authorized(context);
 const {error}=await db.from("site_appearance_drafts").upsert({tenant_id:context.tenantId,draft:data,updated_at:new Date().toISOString()},{onConflict:"tenant_id"});
 if(error)throw new Error("Falha ao salvar rascunho");
 return {ok:true};
});
export const publishSiteAppearanceDraft=createServerFn({method:"POST"})
 .middleware([requireSupabaseAuth]).handler(async({context})=>{
 const db=await authorized(context);
 const {data:row,error:readError}=await db.from("site_appearance_drafts").select("draft").eq("tenant_id",context.tenantId).maybeSingle();
 if(readError||!row)throw new Error("Salve um rascunho antes de publicar");
 const published=appearance.parse(row.draft);
 const {data:updated,error}=await db.from("tenant_company_profiles").update(published).eq("tenant_id",context.tenantId).select("tenant_id").maybeSingle();
 if(error||!updated)throw new Error("Falha ao publicar identidade visual");
 await db.from("site_appearance_drafts").update({published_at:new Date().toISOString()}).eq("tenant_id",context.tenantId);
 return {ok:true};
});
