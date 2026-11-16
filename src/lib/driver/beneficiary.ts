import {db} from "@/lib/db";
import {DriverError,integer,text} from "./errors";
import {phoneNumber} from "./auth";
export async function requestPayoutDestination(driverId:string,body:Record<string,unknown>) {
  const expectedVersion=integer(body.expectedVersion,"Version"),accountName=text(body.accountName,"M-Pesa account name",3,100);
  if(body.acknowledged!==true)throw new DriverError(400,"ACKNOWLEDGEMENT_REQUIRED","Confirm that the payout number belongs to your M-Pesa account. Finance must verify ownership before approval.");
  await db.$transaction(async tx=>{
    const driver=await tx.driver.findUniqueOrThrow({where:{id:driverId}});
    const phone=body.phoneNumber===undefined?phoneNumber(driver.phone):phoneNumber(body.phoneNumber);
    const current=await tx.driverPayoutDestination.findUnique({where:{driverId}});
    if(current?.phone===phone && current.accountName===accountName && ["pending_review","approved"].includes(current.status))return;
    if(await tx.payoutRecord.count({where:{driverId,OR:[{status:{in:["processing","ambiguous"]}},{status:"needs_review",attempts:{some:{state:{in:["submitting","processing","ambiguous"]}}}}]}}))throw new DriverError(409,"TRANSFER_UNRESOLVED","Finance must reconcile an outstanding transfer before payout details change.");
    if(current){
      const updated=await tx.driverPayoutDestination.updateMany({where:{driverId,version:expectedVersion},data:{phone,accountName,status:"pending_review",version:{increment:1},acknowledgedAt:new Date(),reviewedAt:null,reviewedBy:null,reviewNote:null}});
      if(!updated.count)throw new DriverError(409,"DESTINATION_CHANGED","Refresh payout details before requesting a change.");
    }else{
      if(expectedVersion!==0)throw new DriverError(409,"DESTINATION_CHANGED","Refresh payout details before requesting a change.");
      await tx.driverPayoutDestination.create({data:{driverId,phone,accountName,acknowledgedAt:new Date()}});
    }
    await tx.auditLog.create({data:{actorId:driverId,actorName:"Driver",actorRole:"driver",action:"driver.payout_destination_requested",entity:"driver",entityId:driverId}});
  });return {ok:true};
}
export async function reviewPayoutDestination(body:Record<string,unknown>,actor:{id:string;name:string}) {
  const id=text(body.id,"Destination",4,80),version=integer(body.expectedVersion,"Version"),note=text(body.note,"Verification note",5,500);
  if(!["approve","reject"].includes(String(body.action)))throw new DriverError(400,"INVALID_ACTION","Choose approve or reject.");
  await db.$transaction(async tx=>{
    const row=await tx.driverPayoutDestination.findUnique({where:{id},include:{driver:{include:{application:true}}}});
    if(!row || row.status!=="pending_review" || row.version!==version)throw new DriverError(409,"DESTINATION_CHANGED","Refresh the destination before reviewing.");
    if(body.action==="approve" && (row.driver.application?.status!=="approved" || row.driver.status!=="active"))throw new DriverError(409,"APPLICATION_NOT_APPROVED","Approve driver identity evidence before verifying a beneficiary.");
    if(await tx.payoutRecord.count({where:{driverId:row.driverId,OR:[{status:{in:["processing","ambiguous"]}},{status:"needs_review",attempts:{some:{state:{in:["submitting","processing","ambiguous"]}}}}]}}))throw new DriverError(409,"TRANSFER_UNRESOLVED","Reconcile outstanding transfers before changing a beneficiary.");
    const updated=await tx.driverPayoutDestination.updateMany({where:{id,version,status:"pending_review"},data:{status:body.action==="approve"?"approved":"rejected",version:{increment:1},reviewedBy:actor.id,reviewedAt:new Date(),reviewNote:note}});
    if(!updated.count)throw new DriverError(409,"DESTINATION_CHANGED","Another reviewer changed these details.");
    if(body.action==="approve")await tx.driver.update({where:{id:row.driverId},data:{mpesaNumber:row.phone}});
    await tx.auditLog.create({data:{actorId:actor.id,actorName:actor.name,actorRole:"finance",action:`driver.payout_destination_${body.action}`,entity:"payout_destination",entityId:id,metadata:JSON.stringify({note})}});
  });return {ok:true};
}
