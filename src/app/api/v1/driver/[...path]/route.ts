import {db} from "@/lib/db";
import {requireDriver, requestChallenge, requestEmailChallenge, verifyChallenge} from "@/lib/driver/auth";
import {DriverError, integer} from "@/lib/driver/errors";
import {onboarding, saveProfile, submitApplication, uploadDocument, removePendingDocument, driverEligibility} from "@/lib/driver/onboarding";
import {maxDocumentBytes} from "@/lib/driver/catalogue";
import {driverEarnings} from "@/lib/driver/earnings";
import {supportCases,createSupportCase} from "@/lib/driver/support";
import {driverTrips,driverTripCommand} from "@/lib/driver/trips";
import {requestPayoutDestination} from "@/lib/driver/beneficiary";
import {after} from "next/server";
import {dispatchInstantPayouts} from "@/lib/money";
import {driverServiceStatus} from "@/lib/driver/readiness";
import {enforceRouteLimit, requestDestinationRoute, requestDriverRoute} from "@/lib/driver/navigation";
import {amazonLocationConfigured, satelliteTile, searchDriverDestinations} from "@/lib/driver/amazon-location";

import { driverProfilePhoto, maxProfilePhotoBytes, removeDriverProfilePhoto, saveDriverProfilePhoto } from "@/lib/driver/profile-photo";

export const runtime="nodejs";
type Context={params:Promise<{path:string[]}>};
async function boundedBody(req:Request, max:number) {
  if(Number(req.headers.get("content-length")||0)>max) throw new DriverError(413,"FILE_TOO_LARGE","The request exceeds the file limit.");
  const reader=req.body?.getReader(); if(!reader) return Buffer.alloc(0);
  const chunks:Uint8Array[]=[];let size=0;
  try { while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new DriverError(413,"FILE_TOO_LARGE","The request exceeds the file limit.");}chunks.push(value);} }
  finally {reader.releaseLock();}
  return Buffer.concat(chunks);
}
async function handler(req:Request,context:Context) {
  try {
    const path=(await context.params).path.join("/");
    if(path==="status" && req.method==="GET")return Response.json(driverServiceStatus(),{headers:{"Cache-Control":"no-store"}});
    const json=async()=>{
      if(req.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")throw new DriverError(415,"JSON_REQUIRED","Send an application/json request.");
      try {const body=JSON.parse((await boundedBody(req,16384)).toString());if(!body || Array.isArray(body) || typeof body!=="object")throw new Error();return body as Record<string,unknown>;}catch(error){if(error instanceof DriverError)throw error;throw new DriverError(400,"INVALID_JSON","Invalid request body.");}
    };
    if(path==="auth/challenges" && req.method==="POST") return Response.json(await requestChallenge((await json()).phone),{headers:{"Cache-Control":"no-store"}});
    if(path==="auth/email-challenges" && req.method==="POST") {
      const body = await json();
      return Response.json(await requestEmailChallenge(body.email, body.intent),{headers:{"Cache-Control":"no-store"}});
    }
    if(path==="auth/sessions" && req.method==="POST") return Response.json(await verifyChallenge(await json()),{headers:{"Cache-Control":"no-store"}});
    const session=await requireDriver(req), driverId=session.driverId;
    let result:unknown;
    if(path==="auth/session" && req.method==="DELETE") {await db.driverSession.update({where:{id:session.id},data:{revokedAt:new Date()}});result={ok:true};}
    else if(path==="me" && req.method==="GET") result={driver:{id:driverId,name:session.driver.name,phone:session.driver.phone,status:session.driver.status},eligibility:await driverEligibility(driverId)};
    else if(path==="profile-photo" && req.method==="GET") result=await driverProfilePhoto(driverId);
    else if(path==="profile-photo" && req.method==="PUT") {
      if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "image/jpeg") {
        throw new DriverError(415, "INVALID_PROFILE_PHOTO", "Choose a readable photo.");
      }
      await enforceRouteLimit(driverId, "profile-photo", 6, 30);
      result=await saveDriverProfilePhoto(driverId, await boundedBody(req, maxProfilePhotoBytes));
    }
    else if(path==="profile-photo" && req.method==="DELETE") result=await removeDriverProfilePhoto(driverId);
    else if(path==="onboarding" && req.method==="GET") result=await onboarding(driverId);
    else if(path==="onboarding" && req.method==="PUT") result=await saveProfile(driverId,await json());
    else if(path==="onboarding/submissions" && req.method==="POST") result=await submitApplication(driverId,await json());
    else if(path==="earnings" && req.method==="GET") result=await driverEarnings(driverId,new URL(req.url));
    else if(path==="payout-destination" && req.method==="POST")result=await requestPayoutDestination(driverId,await json());
    else if(path==="trips" && req.method==="GET")result=await driverTrips(driverId);
    else if(path==="navigation/route" && req.method==="POST")result=await requestDriverRoute(driverId,await json());
    else if(path==="navigation/search" && req.method==="POST" && amazonLocationConfigured()) {
      await enforceRouteLimit(driverId, "search", 10, 120);
      result=await searchDriverDestinations(await json());
    }
    else if(path==="navigation/destination" && req.method==="POST")result=await requestDestinationRoute(driverId,await json());
    else if(/^navigation\/satellite\/\d{1,2}\/\d{1,6}\/\d{1,6}$/.test(path) && req.method==="GET" && amazonLocationConfigured()) {
      const [, , z, x, y] = path.split("/");
      await enforceRouteLimit(driverId, "satellite", 180, 1500);
      return satelliteTile(z, x, y);
    }
    else if(/^trips\/[^/]+\/commands$/.test(path) && req.method==="POST"){
      const body=await json(),tripId=path.split("/")[1];result=await driverTripCommand(driverId,tripId,body);
      if(body.action==="complete")after(()=>dispatchInstantPayouts(driverId,tripId));
    }
    else if(path==="support" && req.method==="GET")result=await supportCases(driverId);
    else if(path==="support" && req.method==="POST")result=await createSupportCase(driverId,await json());
    else if (/^documents\/[a-zA-Z0-9_-]{1,128}$/.test(path) && req.method === "DELETE") {
      const version = integer((await json()).expectedVersion, "Version");
      result = await removePendingDocument(driverId, path.split("/")[1], version);
    }
    else if(path.startsWith("documents/") && req.method==="POST" && path.split("/").length===2) {
      const version=integer(Number(req.headers.get("x-application-version")),"Version");
      if(!req.headers.has("x-application-version"))throw new DriverError(400,"VERSION_REQUIRED","Application version is required.");
      result=await uploadDocument(driverId,path.split("/")[1],req.headers.get("x-document-expiry"),version,await boundedBody(req,maxDocumentBytes()),(req.headers.get("content-type")||"").split(";")[0]);
    } else throw new DriverError(404,"NOT_FOUND","Driver endpoint not found.");
    return Response.json(result,{headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    if(error instanceof DriverError) return Response.json({error:error.message,code:error.code},{status:error.status,headers:{"Cache-Control":"no-store",...(error.status===429?{"Retry-After":"60"}:{})}});
    return Response.json({error:"The driver service is temporarily unavailable.",code:"SERVICE_UNAVAILABLE"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
export const GET=handler;
export const POST=handler;
export const PUT=handler;
export const DELETE=handler;
