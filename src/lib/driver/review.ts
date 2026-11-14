import {db} from "@/lib/db";
import {getAdminSession} from "@/lib/session";
import {isLocalDemoEnabled} from "@/lib/runtime-mode";
import {requirements,POLICY_VERSION} from "./catalogue";
import {DriverError,integer,text} from "./errors";
import {sendOnboardingWelcomeEmail} from "./email";
import {DRIVER_DOCUMENT_DAY_MS} from "./eligibility";

export async function requireReviewer(req:Request,role:"compliance"|"finance"="compliance") {
  const session=await getAdminSession();
  if(!session)throw new DriverError(401,"UNAUTHENTICATED","Sign in to compliance.");
  const allowed=(process.env[role==="finance"?"DRIVER_FINANCE_REVIEWERS":"DRIVER_COMPLIANCE_REVIEWERS"]||"").split(",").map(s=>s.trim().toLowerCase());
  if(!isLocalDemoEnabled() && !allowed.includes(session.identifier.toLowerCase()))throw new DriverError(403,"REVIEWER_REQUIRED","Compliance reviewer access is required.");
  if(req.method!=="GET") {
    const expected=isLocalDemoEnabled()?`http://${req.headers.get("host")}`:process.env.MIRELI_PUBLIC_ORIGIN;
    if(!expected || (!isLocalDemoEnabled() && !expected.startsWith("https://")))throw new DriverError(503,"ORIGIN_NOT_CONFIGURED","Compliance origin is not configured.");
    if(req.headers.get("origin")!==expected)throw new DriverError(403,"ORIGIN_REJECTED","Request origin is invalid.");
  }
  return session;
}
export async function reviewApplication(id:string,body:Record<string,unknown>,actor:{id:string;name:string}) {
  const version=integer(body.expectedVersion,"Version"),action=text(body.action,"Action",3,30);
  const reason=typeof body.reason==="string"?body.reason.trim().slice(0,500):"";
  let approvedDriverId:string|null=null;
  if(["reject_document","needs_changes","suspend"].includes(action) && reason.length<5)throw new DriverError(400,"REASON_REQUIRED","Give an actionable reason.");
  await db.$transaction(async tx=>{
    const app=await tx.driverApplication.findUnique({where:{id},include:{documents:{where:{state:{not:"replaced"}}}}});
    if(!app)throw new DriverError(404,"NOT_FOUND","Application not found.");
    if(app.version!==version)throw new DriverError(409,"STALE_APPLICATION","Another reviewer changed this application. Refresh.");
    const now=new Date();let status=app.status;
    if(action==="approve_document" || action==="reject_document") {
      if(!["submitted","approved"].includes(app.status))throw new DriverError(409,"NOT_SUBMITTED","Documents can be reviewed after submission.");
      const document=app.documents.find(d=>d.id===body.documentId);
      if(!document)throw new DriverError(404,"NOT_FOUND","Current document not found.");
      if(document.state!=="pending_review" || !document.objectKey)throw new DriverError(409,"DOCUMENT_ALREADY_REVIEWED","Choose pending evidence for review.");
      const approving = action === "approve_document";
      if(approving && (!(["clean",...(isLocalDemoEnabled()?["clean_demo"]:[])].includes(document.scanState)) || (document.expiresAt && document.expiresAt<=now)))throw new DriverError(409,"DOCUMENT_NOT_READY","Document must pass scanning and be unexpired.");
      const changed = await tx.driverDocument.updateMany({where:{id:document.id,state:"pending_review",scanState:document.scanState},
        data:{state:approving?"approved":"rejected",reviewedBy:actor.id,reviewedAt:now,reviewReason:reason||null,filePurgeAt:new Date(now.getTime()+7*DRIVER_DOCUMENT_DAY_MS)}});
      if(changed.count!==1)throw new DriverError(409,"DOCUMENT_CHANGED","Refresh the application before reviewing.");
      if (approving) await tx.driverDocument.updateMany({where:{applicationId:id,type:document.type,id:{not:document.id},state:"approved"},
        data:{state:"replaced",filePurgeAt:now}});
    } else if(action==="approve") {
      if(app.status!=="submitted")throw new DriverError(409,"NOT_SUBMITTED","Application must be submitted.");
      if(app.policyVersion!==POLICY_VERSION)throw new DriverError(409,"POLICY_UPDATED","The driver must acknowledge the current policy.");
      const missing=requirements.filter(r=>!app.documents.some(d=>d.type===r.id && d.state==="approved" && (!d.expiresAt || d.expiresAt>now) && (d.scanState==="clean" || (isLocalDemoEnabled() && d.scanState==="clean_demo"))));
      if(missing.length)throw new DriverError(409,"OUTSTANDING_DOCUMENTS","Approve all required current documents first.");
      status="approved";approvedDriverId=app.driverId;await tx.driver.update({where:{id:app.driverId},data:{status:"active"}});
    } else if(action==="needs_changes") {status="changes_requested";await tx.driver.update({where:{id:app.driverId},data:{status:"applicant"}});}
    else if(action==="suspend") {status="suspended";await tx.driver.update({where:{id:app.driverId},data:{status:"suspended"}});}
    else throw new DriverError(400,"INVALID_ACTION","Review action is invalid.");
    const updated=await tx.driverApplication.updateMany({where:{id,version},data:{version:{increment:1},status,reviewedBy:actor.id,reviewedAt:now,reviewReason:reason||app.reviewReason}});
    if(updated.count!==1)throw new DriverError(409,"STALE_APPLICATION","Refresh before reviewing.");
    await tx.auditLog.create({data:{actorId:actor.id,actorName:actor.name,actorRole:"compliance",action:`driver.review.${action}`,entity:"driver_application",entityId:id,metadata:JSON.stringify({documentId:body.documentId??null,reason,version})}});
  });
  if(approvedDriverId) {
    // The approval is already committed, so this is best-effort by design.
    const approved=await db.driver.findUnique({where:{id:approvedDriverId},select:{email:true,name:true}}).catch(()=>null);
    if(approved?.email) await sendOnboardingWelcomeEmail({email:approved.email,driverName:approved.name});
  }
  return {ok:true};
}
