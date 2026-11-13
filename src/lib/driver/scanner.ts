import {readDocument} from "./storage";
import {db} from "@/lib/db";
import {DriverError} from "./errors";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,isAbsolute,resolve,dirname,basename} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHash} from "node:crypto";
import {validFile} from "./catalogue";
import {DRIVER_DOCUMENT_DAY_MS} from "./eligibility";
const execute=promisify(execFile);
export async function scanDocument(id:string,actorId:string) {
  const command=process.env.DRIVER_SCAN_COMMAND;
  if(!command || !isAbsolute(command))throw new DriverError(503,"SCANNER_NOT_CONFIGURED","Configure the private malware scanner before approving documents.");
  const document=await db.driverDocument.findUnique({where:{id}});
  if(!document?.objectKey || document.state!=="pending_review")throw new DriverError(404,"NOT_FOUND","Pending document file not found.");
  const parent=resolve(tmpdir());
  const directory=await mkdtemp(join(parent,"mireli-scan-"));
  const owned=()=>dirname(resolve(directory))===parent && basename(directory).startsWith("mireli-scan-");
  if(!owned())throw new Error("Unexpected scan directory");
  let scanState="pending";
  try {
    const bytes=await readDocument(document.objectKey);
    if(bytes.length!==document.bytes || createHash("sha256").update(bytes).digest("hex")!==document.sha256 || !validFile(document.mime,bytes))throw new DriverError(409,"EVIDENCE_CHANGED","Stored evidence does not match the uploaded file. Replace it before review.");
    const file=join(directory,"evidence");await writeFile(file,bytes,{mode:0o600});
    try {await execute(command,["--no-summary","--",file],{timeout:60000,maxBuffer:16384});scanState="clean";}
    catch(error) {if((error as {code?:unknown}).code===1)scanState="infected";else throw new DriverError(503,"SCAN_UNAVAILABLE","Scanning failed. Document remains quarantined.");}
    const changed=await db.driverDocument.updateMany({where:{id,state:"pending_review",sha256:document.sha256},data:{scanState,...(scanState==="infected"?{state:"rejected",reviewReason:"File security scan failed.",filePurgeAt:new Date(Date.now()+7*DRIVER_DOCUMENT_DAY_MS)}:{})}});
    if(changed.count!==1)return {ok:false,scanState:"replaced"};
    await db.auditLog.create({data:{actorId,actorRole:"compliance",actorName:"Compliance",action:"driver.document_scan",entity:"driver_document",entityId:id,metadata:JSON.stringify({scanState})}});
    return {ok:true,scanState};
  } finally {if(owned())await rm(directory,{recursive:true,force:true});}
}
