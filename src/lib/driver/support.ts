import {createHash, randomUUID} from "node:crypto";
import {db} from "@/lib/db";
import {DriverError,text} from "./errors";
import {sendDriverSupportAcknowledgementEmail} from "./email";

export const SUPPORT_CASE_CREATION_LIMIT=10;
export const SUPPORT_CASE_CREATION_WINDOW_MS=60*60*1000;

function supportRatePrefixes(driverId:string):{rolling:string;legacy:string} {
  const driverHash=createHash("sha256").update(driverId).digest("hex");
  return {rolling:`support:case:rolling:${driverHash}:`,legacy:`support:case:${driverHash}:`};
}

function assertSameSupportRequest(row:{category:string;message:string},category:string,message:string):void {
  if(row.category!==category||row.message!==message)throw new DriverError(409,"ACTION_CONFLICT","This request ID was used for a different message.");
}

export async function supportCases(driverId:string) {
  return {cases:await db.driverSupportCase.findMany({where:{driverId},orderBy:{createdAt:"desc"},take:50,select:{id:true,category:true,message:true,status:true,reply:true,createdAt:true,updatedAt:true}})};
}

export async function createSupportCase(driverId:string,body:Record<string,unknown>) {
  const clientActionId=text(body.clientActionId,"Request ID",10,100),category=text(body.category,"Category",3,20),message=text(body.message,"Message",10,2000);
  if(!["account","documents","payout","trip","safety"].includes(category))throw new DriverError(400,"INVALID_CATEGORY","Support category is invalid.");
  const where={driverId_clientActionId:{driverId,clientActionId}};
  const {rolling:ratePrefix,legacy:legacyPrefix}=supportRatePrefixes(driverId);
  const result=await db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ratePrefix}))`;
    const existing=await tx.driverSupportCase.findUnique({where});
    if(existing){
      assertSameSupportRequest(existing,category,message);
      return {row:existing,created:false};
    }
    const now=new Date();
    await tx.driverRateLimit.deleteMany({where:{key:{startsWith:"support:case:"},expiresAt:{lte:now}}});
    const active=await tx.driverRateLimit.findMany({
      where:{expiresAt:{gt:now},OR:[{key:{startsWith:ratePrefix}},{key:{startsWith:legacyPrefix}}]},
      orderBy:{expiresAt:"asc"},
      select:{expiresAt:true,count:true},
    });
    const used=active.reduce((sum,row)=>sum+(row.count??1),0);
    if(used>=SUPPORT_CASE_CREATION_LIMIT){
      const concurrent=await tx.driverSupportCase.findUnique({where});
      if(concurrent){
        assertSameSupportRequest(concurrent,category,message);
        return {row:concurrent,created:false};
      }
      let freed=0,retryAt=now.getTime()+SUPPORT_CASE_CREATION_WINDOW_MS;
      for(const row of active){
        freed+=row.count??1;
        if(used-freed<SUPPORT_CASE_CREATION_LIMIT){retryAt=row.expiresAt.getTime();break;}
      }
      const retryAfter=Math.max(1,Math.ceil((retryAt-now.getTime())/1000));
      throw new DriverError(429,"RATE_LIMITED","Please wait before creating another support request.",retryAfter);
    }
    const created=await tx.driverSupportCase.createMany({data:[{driverId,clientActionId,category,message}],skipDuplicates:true});
    if(created.count===0){
      const concurrent=await tx.driverSupportCase.findUnique({where});
      if(!concurrent)throw new DriverError(503,"SUPPORT_UNAVAILABLE","The support request could not be saved. Please try again.");
      assertSameSupportRequest(concurrent,category,message);
      return {row:concurrent,created:false};
    }
    const row=await tx.driverSupportCase.findUnique({where});
    if(!row)throw new DriverError(503,"SUPPORT_UNAVAILABLE","The support request could not be saved. Please try again.");
    await tx.auditLog.create({data:{actorId:driverId,actorName:"Driver",actorRole:"driver",action:"driver.support_case_created",entity:"driver_support",entityId:row.id,metadata:JSON.stringify({category})}});
    await tx.driverRateLimit.create({data:{key:`${ratePrefix}${randomUUID()}`,count:1,expiresAt:new Date(now.getTime()+SUPPORT_CASE_CREATION_WINDOW_MS)}});
    return {row,created:true};
  },{maxWait:10000,timeout:15000});
  if(result.created){
    const driver=await db.driver.findUnique({where:{id:driverId},select:{id:true,name:true,email:true,emailVerifiedAt:true}});
    if(driver?.email&&driver.emailVerifiedAt)await sendDriverSupportAcknowledgementEmail({email:driver.email,driverId:driver.id,caseId:result.row.id,driverName:driver.name});
  }
  return supportCases(driverId);
}
