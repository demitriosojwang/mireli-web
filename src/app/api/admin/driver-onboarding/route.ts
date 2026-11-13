import {db} from "@/lib/db";
import {requireReviewer,reviewApplication} from "@/lib/driver/review";
import {DriverError,text} from "@/lib/driver/errors";

async function handler(req:Request) {
  try {
    const actor=await requireReviewer(req);
    if(req.method==="GET") {
      const applications=await db.driverApplication.findMany({take:100,orderBy:{updatedAt:"desc"},include:{driver:{select:{name:true,phone:true,plate:true,cabType:true,capacity:true}},documents:{where:{state:{not:"replaced"}},orderBy:{createdAt:"desc"},select:{id:true,type:true,state:true,scanState:true,expiresAt:true,reviewReason:true,mime:true,bytes:true,filePurgeAt:true,filePurgedAt:true}}}});
      return Response.json({applications},{headers:{"Cache-Control":"no-store"}});
    }
    const body=await req.json();return Response.json(await reviewApplication(text(body.applicationId,"Application",5,100),body,actor));
  } catch(error) {
    if(error instanceof DriverError)return Response.json({error:error.message,code:error.code},{status:error.status});
    return Response.json({error:"Compliance service unavailable",code:"SERVICE_UNAVAILABLE"},{status:503});
  }
}
export const GET=handler;
export const POST=handler;
