import {requireReviewer} from "@/lib/driver/review";
import {scanDocument} from "@/lib/driver/scanner";
import {readDocument} from "@/lib/driver/storage";
import {DriverError} from "@/lib/driver/errors";
import {db} from "@/lib/db";
import {createHash} from "node:crypto";
async function handle(req:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    const actor=await requireReviewer(req);const {id}=await params;
    if(req.method==="POST")return Response.json(await scanDocument(id,actor.id));
    const document=await db.driverDocument.findUnique({where:{id}});
    if(!document || document.state==="replaced")throw new DriverError(404,"NOT_FOUND","Current document not found.");
    if(document.filePurgedAt || (document.filePurgeAt && document.filePurgeAt <= new Date()))throw new DriverError(410,"EVIDENCE_REMOVED","The file retention period has ended. The verification record remains.");
    const bytes=await readDocument(document.objectKey);
    if(bytes.length!==document.bytes || createHash("sha256").update(bytes).digest("hex")!==document.sha256)throw new DriverError(409,"EVIDENCE_CHANGED","Stored evidence does not match the uploaded file.");
    await db.auditLog.create({data:{actorId:actor.id,actorName:actor.name,actorRole:"compliance",action:"driver.document_read",entity:"driver_document",entityId:id}});
    return new Response(new Uint8Array(bytes),{headers:{"Content-Type":document.mime,"Content-Disposition":`attachment; filename="evidence.${document.mime==="application/pdf"?"pdf":document.mime==="image/png"?"png":"jpg"}"`,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox; default-src 'none'"}});
  }catch(error){return Response.json({error:error instanceof DriverError?error.message:"Document service unavailable"},{status:error instanceof DriverError?error.status:503});}
}
export const GET=handle;export const POST=handle;
