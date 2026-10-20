import { decryptIntegrationSecret } from "@/lib/integration-crypto.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Read-only external probe with preventative OAuth renewal. Never sends orders or invoices. */
export async function probeBlingConnections() {
  const db = supabaseAdmin as any;
  const { data: configs, error } = await db.from("bling_config")
    .select("id,tenant_id,active,expires_at,access_token,refresh_token,client_id,client_secret_encrypted")
    .eq("active",true).limit(25);
  if(error) throw new Error(error.message);
  const results: { tenantId:string; ok:boolean; reason:string }[] = [];
  for(const cfg of configs??[]) {
    let ok=false;
    let reason="api_unavailable";
    try {
      let token=String(cfg.access_token??"");
      if(!token) throw new Error("missing_access_token");
      const expiry=Date.parse(String(cfg.expires_at??"")) || 0;
      if(expiry-Date.now()<60*60*1000) {
        const clientId=String(cfg.client_id||process.env.BLING_CLIENT_ID||"");
        const clientSecret=cfg.client_secret_encrypted
          ? await decryptIntegrationSecret(cfg.client_secret_encrypted)
          : String(process.env.BLING_CLIENT_SECRET||"");
        if(!clientId||!clientSecret||!cfg.refresh_token) throw new Error("missing_refresh_credentials");
        const basic=Buffer.from(clientId+":"+clientSecret).toString("base64");
        const refresh=await fetch("https://api.bling.com.br/Api/v3/oauth/token",{
          method:"POST",
          headers:{"Content-Type":"application/x-www-form-urlencoded",Authorization:"Basic "+basic,Accept:"1.0","enable-jwt":"1"},
          body:new URLSearchParams({grant_type:"refresh_token",refresh_token:String(cfg.refresh_token)}),
          signal:AbortSignal.timeout(12000)
        });
        const payload=await refresh.json().catch(()=>({}));
        if(!refresh.ok||!payload.access_token) throw new Error("oauth_refresh_http_"+refresh.status);
        token=payload.access_token;
        const {error:saveError}=await db.from("bling_config").update({
          access_token:token,refresh_token:payload.refresh_token??cfg.refresh_token,
          expires_at:new Date(Date.now()+Number(payload.expires_in??3600)*1000).toISOString(),
          updated_at:new Date().toISOString()
        }).eq("id",cfg.id).eq("tenant_id",cfg.tenant_id);
        if(saveError) throw new Error("oauth_persist_failed");
      }
      const response=await fetch("https://api.bling.com.br/Api/v3/contatos?pagina=1&limite=1",{
        headers:{Authorization:"Bearer "+token,Accept:"application/json","enable-jwt":"1"},
        signal:AbortSignal.timeout(12000)
      });
      if(!response.ok) throw new Error("api_probe_http_"+response.status);
      ok=true;reason="authenticated_api_ok";
    }catch(e){reason=e instanceof Error?e.message.slice(0,90):"unknown_error";}
    await db.from("bling_config").update({last_test_at:new Date().toISOString(),
      last_test_status:ok?"sucesso":"erro",updated_at:new Date().toISOString()
    }).eq("id",cfg.id).eq("tenant_id",cfg.tenant_id);
    await db.from("bling_sync_logs").insert({tenant_id:cfg.tenant_id,entity:"pedido",
      action:"oauth_health_monitor",status:ok?"sucesso":"erro",message:reason});
    results.push({tenantId:cfg.tenant_id,ok,reason});
  }
  return { checked:results.length, healthy:results.filter(x=>x.ok).length, errors:results.filter(x=>!x.ok).map(x=>x.reason) };
}
