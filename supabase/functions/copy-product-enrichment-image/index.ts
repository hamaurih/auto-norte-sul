import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
const isPrivate=(ip:string)=>/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(ip);
Deno.serve(async(req)=>{
 try{
  if(req.method!=="POST") return json({error:"Método inválido"},405);
  const url=Deno.env.get("SUPABASE_URL")!;
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth=req.headers.get("authorization");
  if(!auth) return json({error:"Não autenticado"},401);
  const userClient=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
  const {data:{user}}=await userClient.auth.getUser();
  if(!user) return json({error:"Sessão inválida"},401);
  const {candidateId}=await req.json();
  if(!candidateId) return json({error:"Sugestão obrigatória"},400);
  const admin=createClient(url,serviceKey);
  const {data:candidate,error}=await admin.from("product_enrichment_candidates")
   .select("id,tenant_id,product_id,image_url,status").eq("id",candidateId).single();
  if(error||!candidate) return json({error:"Sugestão não encontrada"},404);
  const {data:membership}=await admin.from("tenant_memberships").select("role").eq("tenant_id",candidate.tenant_id)
   .eq("user_id",user.id).eq("active",true).in("role",["owner","admin","manager"]).maybeSingle();
  if(!membership) return json({error:"Sem permissão"},403);
  if(candidate.status!=="pending") return json({error:"Sugestão já revisada"},409);
  const source=new URL(candidate.image_url);
  if(source.protocol!=="https:"||["localhost","localhost.localdomain"].includes(source.hostname)) return json({error:"Origem de imagem bloqueada"},400);
  const ips=[...(await Deno.resolveDns(source.hostname,"A").catch(()=>[])),...(await Deno.resolveDns(source.hostname,"AAAA").catch(()=>[]))];
  if(!ips.length||ips.some(isPrivate)) return json({error:"Destino de rede não permitido"},400);
  const response=await fetch(source,{redirect:"error",signal:AbortSignal.timeout(10000),headers:{"user-agent":"AutoNorteSulCatalog/1.0"}});
  if(!response.ok) return json({error:`A origem respondeu ${response.status}`},422);
  const mime=(response.headers.get("content-type")||"").split(";")[0].toLowerCase();
  const allowed:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
  if(!allowed[mime]) return json({error:"Formato de imagem não permitido"},422);
  const declared=Number(response.headers.get("content-length")||0);
  if(declared>5*1024*1024) return json({error:"Imagem maior que 5 MB"},422);
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.byteLength>5*1024*1024) return json({error:"Imagem maior que 5 MB"},422);
  const path=`${candidate.tenant_id}/${candidate.product_id}/${candidate.id}.${allowed[mime]}`;
  const {error:uploadError}=await admin.storage.from("product-images").upload(path,bytes,{contentType:mime,upsert:false,cacheControl:"31536000"});
  if(uploadError&&!uploadError.message.toLowerCase().includes("already exists")) throw uploadError;
  const {data:publicData}=admin.storage.from("product-images").getPublicUrl(path);
  const storageUrl=publicData.publicUrl;
  const {error:updateError}=await admin.from("product_enrichment_candidates").update({storage_url:storageUrl}).eq("id",candidate.id);
  if(updateError) throw updateError;
  return json({ok:true,storageUrl});
 }catch(error){console.error(error);return json({error:error instanceof Error?error.message:"Erro inesperado"},500)}
});
