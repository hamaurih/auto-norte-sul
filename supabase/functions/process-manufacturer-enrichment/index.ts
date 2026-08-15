import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
const normalize=(v:string)=>v.toUpperCase().replace(/[^A-Z0-9]/g,"");
const text=(html:string)=>html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim();
const meta=(html:string,key:string)=>html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)`,"i"))?.[1]
  ??html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,"i"))?.[1]??null;
const absolute=(href:string,base:string)=>{try{return new URL(href,base)}catch{return null}};
const privateIp=(ip:string)=>/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(ip);

async function safeHtml(url:URL,domains:string[]){
 if(url.protocol!=="https:"||!domains.includes(url.hostname.toLowerCase())) throw new Error("Domínio fora da lista permitida");
 const ips=[...(await Deno.resolveDns(url.hostname,"A").catch(()=>[])),...(await Deno.resolveDns(url.hostname,"AAAA").catch(()=>[]))];
 if(!ips.length||ips.some(privateIp)) throw new Error("Destino de rede bloqueado");
 const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(8000),headers:{"user-agent":"AutoNorteSulCatalog/1.0 (+catalog enrichment)"}});
 if(!response.ok) throw new Error(`Fonte respondeu ${response.status}`);
 const type=response.headers.get("content-type")??"";
 if(!type.toLowerCase().includes("text/html")) throw new Error("Fonte não retornou HTML");
 const declared=Number(response.headers.get("content-length")||0);
 if(declared>2_000_000) throw new Error("Página excede 2 MB");
 const html=await response.text();
 if(html.length>2_000_000) throw new Error("Página excede 2 MB");
 return html;
}

function links(html:string,base:string,domains:string[]){
 const found:Array<{url:URL,label:string}>=[];
 for(const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  const url=absolute(match[1],base); if(!url||url.protocol!=="https:"||!domains.includes(url.hostname.toLowerCase())) continue;
  url.hash=""; found.push({url,label:text(match[2])});
 }
 return found;
}

async function findOfficialPage(entry:URL,domains:string[],code:string){
 const target=normalize(code); const visited=new Set<string>(); const queue=[entry];
 for(let scanned=0;queue.length&&scanned<35;scanned++){
  const current=queue.shift()!; if(visited.has(current.href)) continue; visited.add(current.href);
  const html=await safeHtml(current,domains);
  const body=text(html);
  if(normalize(body).includes(target)){
   const exact=new RegExp(`c[oó]d\\.?\\s*:\\s*${code.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?:\\s|<)`,"i");
   if(exact.test(html)||exact.test(body)) return {url:current,html};
  }
  const pageLinks=links(html,current.href,domains);
  const direct=pageLinks.find(v=>normalize(v.label).includes(target));
  if(direct){const productHtml=await safeHtml(direct.url,domains);return {url:direct.url,html:productHtml}}
  for(const item of pageLinks){
   if(queue.length>=35) break;
   if(/produto|linha-completa|lampada|farol|kit/i.test(item.url.pathname)&&!visited.has(item.url.href)) queue.push(item.url);
  }
 }
 return null;
}

Deno.serve(async(req)=>{
 try{
  if(req.method!=="POST") return json({error:"Método inválido"},405);
  const projectUrl=Deno.env.get("SUPABASE_URL")!; const auth=req.headers.get("authorization");
  if(!auth) return json({error:"Não autenticado"},401);
  const userClient=createClient(projectUrl,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
  const {data:{user}}=await userClient.auth.getUser(); if(!user) return json({error:"Sessão inválida"},401);
  const {limit=3}=await req.json().catch(()=>({})); const batch=Math.max(1,Math.min(Number(limit)||3,5));
  const admin=createClient(projectUrl,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:memberships}=await admin.from("tenant_memberships").select("tenant_id").eq("user_id",user.id).eq("active",true).in("role",["owner","admin","manager"]);
  const tenantIds=(memberships??[]).map(v=>v.tenant_id); if(!tenantIds.length) return json({error:"Sem permissão"},403);
  const {data:jobs,error}=await admin.from("product_enrichment_jobs")
   .select("id,tenant_id,product_id,attempts,product:products(id,name,manufacturer_code,brand_id,brand:brands(id,name))")
   .in("tenant_id",tenantIds).eq("status","queued").not("product.manufacturer_code","is",null).order("created_at").limit(batch);
  if(error) throw error;
  const results=[];
  for(const job of jobs??[]){
   const product:any=job.product; const code=product?.manufacturer_code?.trim();
   if(!code||!product?.brand_id){results.push({jobId:job.id,status:"skipped",reason:"Produto sem marca ou código"});continue}
   await admin.from("product_enrichment_jobs").update({status:"processing",started_at:new Date().toISOString(),attempts:(job.attempts??0)+1,last_error:null}).eq("id",job.id);
   try{
    const [{data:sources},{data:patterns}]=await Promise.all([
     admin.from("manufacturer_catalog_sources").select("id,name,base_url,search_url_template,allowed_domains,image_usage_note").eq("tenant_id",job.tenant_id).eq("brand_id",product.brand_id).eq("status","active").order("priority",{ascending:false}),
     admin.from("manufacturer_code_patterns").select("code_regex").eq("tenant_id",job.tenant_id).eq("brand_id",product.brand_id).eq("active",true).order("priority",{ascending:false}),
    ]);
    if(patterns?.length&&!patterns.some(p=>{try{return new RegExp(p.code_regex,"i").test(code)}catch{return false}})) throw new Error("Código não corresponde ao padrão cadastrado para a marca");
    let matched:any=null; let source:any=null;
    for(const candidateSource of sources??[]){
     const domains=(candidateSource.allowed_domains??[]).map((v:string)=>v.toLowerCase());
     if(!domains.length) continue;
     const entry=new URL(candidateSource.search_url_template||candidateSource.base_url);
     matched=await findOfficialPage(entry,domains,code); if(matched){source=candidateSource;break}
    }
    if(!matched||!source) throw new Error("Código não localizado nas fontes oficiais cadastradas");
    const pageText=text(matched.html); const title=meta(matched.html,"og:title")??matched.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()??product.name;
    const description=meta(matched.html,"description")??meta(matched.html,"og:description")??pageText.slice(0,1200);
    const imageUrl=meta(matched.html,"og:image");
    const {error:insertError}=await admin.from("product_enrichment_candidates").insert({
     tenant_id:job.tenant_id,job_id:job.id,product_id:job.product_id,source_type:"manufacturer",source_name:source.name,
     source_url:matched.url.href,image_url:imageUrl,suggested_name:text(title).replace(/\s+-\s+SHOCKLIGHT.*$/i,"").trim(),
     suggested_short_description:description.slice(0,240),suggested_description:description,suggested_manufacturer_code:code,
     confidence:97,match_reasons:["Código exato na fonte oficial","Domínio autorizado do fabricante","Padrão de código validado"],status:"pending",
     license_name:source.image_usage_note||null,
    });
    if(insertError) throw insertError;
    await admin.from("product_enrichment_jobs").update({status:"review",finished_at:new Date().toISOString()}).eq("id",job.id);
    results.push({jobId:job.id,status:"review",sourceUrl:matched.url.href});
   }catch(e){const reason=e instanceof Error?e.message:"Falha inesperada";await admin.from("product_enrichment_jobs").update({status:"failed",last_error:reason,finished_at:new Date().toISOString()}).eq("id",job.id);results.push({jobId:job.id,status:"failed",reason})}
  }
  return json({ok:true,processed:results.length,results});
 }catch(error){console.error(error);return json({error:error instanceof Error?error.message:"Erro inesperado"},500)}
});
