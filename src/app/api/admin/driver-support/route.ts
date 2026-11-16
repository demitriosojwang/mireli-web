import {getAdminSession} from "@/lib/session";
import {isLocalDemoEnabled} from "@/lib/runtime-mode";
import {DriverError,text,integer} from "@/lib/driver/errors";
import {db} from "@/lib/db";
import {sendDriverSupportReplyEmail} from "@/lib/driver/email";
async function handle(req:Request) {
  try {
    const actor=await getAdminSession();if(!actor)throw new DriverError(401,"UNAUTHENTICATED","Sign in to support.");
    const allowed=(process.env.DRIVER_SUPPORT_REVIEWERS||"").split(",").map(s=>s.trim().toLowerCase());
    if(!isLocalDemoEnabled()&&!allowed.includes(actor.identifier.toLowerCase()))throw new DriverError(403,"SUPPORT_ROLE_REQUIRED","Support access is required.");
    if(req.method==="GET")return Response.json({cases:await db.driverSupportCase.findMany({orderBy:{createdAt:"desc"},take:100,include:{driver:{select:{name:true,phone:true}}}})},{headers:{"Cache-Control":"no-store"}});
    const origin=isLocalDemoEnabled()?`http://${req.headers.get("host")}`:process.env.MIRELI_PUBLIC_ORIGIN;
    if(!origin || req.headers.get("origin")!==origin)throw new DriverError(403,"ORIGIN_REJECTED","Request origin is invalid.");
    const body=await req.json(),id=text(body.id,"Case",5,100),reply=text(body.reply,"Reply",5,2000),status=text(body.status,"Status",4,20),version=integer(body.expectedVersion,"Version");
    if(!["investigating","resolved"].includes(status))throw new DriverError(400,"INVALID_STATUS","Support status is invalid.");
    const replied=await db.$transaction(async tx=>{
      const updated=await tx.driverSupportCase.updateMany({where:{id,version},data:{reply,status,assignedTo:actor.id,version:{increment:1}}});
      if(updated.count!==1)throw new DriverError(409,"STALE_CASE","Refresh the case before replying.");
      const supportCase=await tx.driverSupportCase.findUnique({where:{id},include:{driver:{select:{id:true,name:true,email:true,emailVerifiedAt:true}}}});
      if(!supportCase)throw new DriverError(409,"STALE_CASE","Refresh the case before replying.");
      await tx.auditLog.create({data:{actorId:actor.id,actorRole:"support",actorName:actor.name,action:"driver.support_reply",entity:"driver_support",entityId:id,metadata:JSON.stringify({status})}});
      return supportCase;
    });
    if(replied.driver.email&&replied.driver.emailVerifiedAt)await sendDriverSupportReplyEmail({email:replied.driver.email,driverId:replied.driver.id,caseId:replied.id,reply,driverName:replied.driver.name});
    return Response.json({ok:true});
  }catch(error){return Response.json({error:error instanceof DriverError?error.message:"Support service unavailable"},{status:error instanceof DriverError?error.status:503});}
}
export const GET=handle;export const POST=handle;
