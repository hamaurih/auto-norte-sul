import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
export const Route=createFileRoute("/api/public/cron/bling-health")({server:{handlers:{
 GET:async({request})=>{
   const expected=process.env.CRON_SECRET;
   const provided=request.headers.get("authorization")?.replace(/^Bearer /i,"");
   if(!expected||!provided||Buffer.byteLength(expected)!==Buffer.byteLength(provided)||!timingSafeEqual(Buffer.from(expected),Buffer.from(provided))) return Response.json({ok:false},{status:401});
   const {probeBlingConnections}=await import("@/lib/bling-connection-monitor.server");
   const report=await probeBlingConnections();
   return Response.json({ok:report.errors.length===0,...report},{status:report.errors.length===0?200:503});
 }
}}});
