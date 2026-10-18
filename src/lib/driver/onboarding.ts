import {db} from "@/lib/db";
import {createHash} from "node:crypto";
import {isLocalDemoEnabled} from "@/lib/runtime-mode";
import {DriverError, integer, text} from "./errors";
import {applicableRequirements, POLICY_VERSION, maxDocumentBytes, requirements, validFile} from "./catalogue";
import {deleteDocument, saveDocument} from "./storage";
import {nairobiDate} from "@/lib/nairobi-time";
import {phoneNumber} from "./auth";
import {evaluateDriverApplication} from "./eligibility";

export {evaluateDriverApplication} from "./eligibility";

const documentFields = {id:true,type:true,mime:true,bytes:true,expiresAt:true,state:true,scanState:true,reviewReason:true,createdAt:true} as const;
export async function onboarding(driverId: string) {
  const app = await db.driverApplication.findUnique({where:{driverId},include:{driver:true,documents:{where:{state:{not:"replaced"}},orderBy:{createdAt:"desc"},select:documentFields}}});
  if (!app) throw new DriverError(404,"APPLICATION_NOT_FOUND","Application not found.");
  return {application:{id:app.id,status:app.status,version:app.version,licenceClass:app.licenceClass,ownsVehicle:app.ownsVehicle,reviewReason:app.reviewReason,submittedAt:app.submittedAt,documents:app.documents},
    profile:{fullName:app.driver.name,phone:app.driver.phone,email:app.driver.email,plate:app.driver.plate,capacity:app.driver.capacity,cabType:app.driver.cabType},
    requirements:applicableRequirements(app.ownsVehicle),policyVersion:POLICY_VERSION,privacyUrl:process.env.DRIVER_PRIVACY_URL??null,termsUrl:process.env.DRIVER_TERMS_URL??null,maxDocumentBytes:maxDocumentBytes(),simulation:isLocalDemoEnabled()};
}
export async function saveProfile(driverId:string, body:Record<string,unknown>) {
  const version=integer(body.expectedVersion,"Version"); const fullName=text(body.fullName,"Full name",3,100);
  const plate=text(body.plate,"Registration",4,15).toUpperCase(); if(!/^[A-Z0-9 -]+$/.test(plate)) throw new DriverError(400,"INVALID_PLATE","Vehicle registration is invalid.");
  const capacity=integer(body.capacity,"Passenger capacity",1,60), licenceClass=text(body.licenceClass,"Licence class",1,20),cabType=text(body.cabType,"Vehicle type",2,80);
  if(typeof body.ownsVehicle!=="boolean") throw new DriverError(400,"INVALID_INPUT","Vehicle ownership is required.");
  await db.$transaction(async tx=>{
    const current=await tx.driver.findUniqueOrThrow({where:{id:driverId}});
    const phone=phoneNumber(body.phone??current.phone);
    if(current.phone && current.phone!==phone)throw new DriverError(409,"PHONE_CHANGE_REVIEW_REQUIRED","Contact support to change an existing phone number.");
    const updated=await tx.driverApplication.updateMany({where:{driverId,version,status:{in:["draft","changes_requested","approved"]}},data:{version:{increment:1},licenceClass,ownsVehicle:body.ownsVehicle as boolean,status:"draft",reviewedBy:null,reviewedAt:null}});
    if(updated.count!==1) throw new DriverError(409,"STALE_APPLICATION","Refresh the application before editing. Submitted applications cannot be changed during review.");
    await tx.driver.update({where:{id:driverId},data:{name:fullName,phone,plate,capacity,cabType,status:"applicant"}});
  });
  return onboarding(driverId);
}
export async function uploadDocument(driverId:string,type:string,expiry:string|null,version:number,bytes:Buffer,mime:string) {
  const requirement=requirements.find(r=>r.id===type);
  if(!requirement || !validFile(mime,bytes) || bytes.length>maxDocumentBytes()) throw new DriverError(400,"INVALID_DOCUMENT","Choose a valid PDF, JPEG or PNG within the file limit.");
  let expiresAt:Date|null=null;
  if(requirement.expires) {
    if(!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry) || Number.isNaN(Date.parse(expiry)) || new Date(expiry).toISOString().slice(0,10)!==expiry || expiry<nairobiDate(new Date()))
      throw new DriverError(400,"EXPIRED_DOCUMENT","Enter the document's valid expiry date as YYYY-MM-DD.");
    expiresAt=new Date(`${expiry}T20:59:59.999Z`);
  }
  const app=await db.driverApplication.findUnique({where:{driverId}});
  if(!app || app.version!==version || !["draft","changes_requested","approved"].includes(app.status)) throw new DriverError(409,"STALE_APPLICATION","Refresh before replacing evidence.");
  const objectKey=await saveDocument(bytes,mime);
  try {
    await db.$transaction(async tx=>{
      const updated=await tx.driverApplication.updateMany({where:{id:app.id,version},data:{version:{increment:1},status:"draft"}});
      if(updated.count!==1) throw new DriverError(409,"STALE_APPLICATION","Another change arrived. Refresh and try again.");
      await tx.driverDocument.updateMany({where:{applicationId:app.id,type,state:{not:"replaced"}},data:{state:"replaced"}});
      await tx.driverDocument.create({data:{applicationId:app.id,type,objectKey,mime,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),expiresAt,scanState:isLocalDemoEnabled()?"clean_demo":"pending"}});
      await tx.driver.update({where:{id:driverId},data:{status:"applicant"}});
    });
  } catch(error) { await deleteDocument(objectKey).catch(()=>{}); throw error; }
  return onboarding(driverId);
}
export async function submitApplication(driverId:string,body:Record<string,unknown>) {
  const version=integer(body.expectedVersion,"Version");
  if(body.policyVersion!==POLICY_VERSION || body.accepted!==true) throw new DriverError(400,"POLICY_REQUIRED","Read and accept the current driver policy before submission.");
  if(!isLocalDemoEnabled() && process.env.DRIVER_POLICY_VERSION!==POLICY_VERSION) throw new DriverError(503,"POLICY_NOT_APPROVED","Driver onboarding policy has not been approved for launch.");
  await db.$transaction(async tx=>{
    const app=await tx.driverApplication.findUnique({where:{driverId},include:{driver:true,documents:{where:{state:{not:"replaced"}}}}});
    if(!app) throw new DriverError(404,"APPLICATION_NOT_FOUND","Application not found.");
    if(app.status==="submitted" && app.version===version+1 && app.policyVersion===POLICY_VERSION) return;
    if(app.version!==version || !["draft","changes_requested"].includes(app.status)) throw new DriverError(409,"STALE_APPLICATION","Refresh before submitting.");
    if(app.driver.name.length<3 || !app.driver.phone || !app.driver.plate || !app.licenceClass || !app.driver.cabType) throw new DriverError(400,"INCOMPLETE_PROFILE","Complete driver contact and vehicle details.");
    const missing=applicableRequirements(app.ownsVehicle).filter(r=>r.required).filter(r=>!app.documents.some(d=>d.type===r.id && d.state!=="rejected" && (!d.expiresAt || d.expiresAt>new Date())));
    if(missing.length) throw new DriverError(400,"MISSING_DOCUMENTS",`Attach current evidence: ${missing.map(r=>r.title).join(", ")}.`);
    const updated=await tx.driverApplication.updateMany({where:{id:app.id,version},data:{status:"submitted",version:{increment:1},policyVersion:POLICY_VERSION,submittedAt:new Date()}});
    if(updated.count!==1) throw new DriverError(409,"STALE_APPLICATION","Refresh before submitting.");
    await tx.auditLog.create({data:{actorId:driverId,actorRole:"driver",actorName:"Driver",action:"driver.application_submitted",entity:"driver_application",entityId:app.id,metadata:JSON.stringify({policyVersion:POLICY_VERSION})}});
  });
  return onboarding(driverId);
}
export async function driverEligibility(driverId:string) {
  const app=await db.driverApplication.findUnique({where:{driverId},include:{driver:true,documents:{where:{state:{not:"replaced"}}}}});
  return evaluateDriverApplication(app,app?.driver.status??"applicant");
}
