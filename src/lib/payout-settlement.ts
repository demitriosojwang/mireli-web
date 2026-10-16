import {db} from "@/lib/db";
import * as daraja from "@/lib/daraja";
import {randomBytes,createHash} from "node:crypto";
import {isLocalDemoEnabled} from "@/lib/runtime-mode";
import {DriverError} from "@/lib/driver/errors";
import {calculateCharterPlatformShare} from "@/lib/charter-pricing";

export function classifySubmission(result:daraja.DarajaResultCode):"completed"|"processing"|"failed"|"ambiguous" {
  if(result.settled && result.resultCode==="0" && result.receipt) return "completed";
  if(result.resultCode==="ACCEPTED" && result.conversationId) return "processing";
  if(["1001","2001"].includes(result.resultCode))return "failed";
  return "ambiguous";
}
export function calculateSettlement(total:number,surcharge:number,platformFee:number,rateBps:number,isCharter:boolean) {
  if(!Number.isSafeInteger(total) || total<0 || !Number.isSafeInteger(surcharge) || surcharge<0 || surcharge>total ||
    !Number.isSafeInteger(platformFee) || platformFee<0 || platformFee>total-surcharge || !Number.isInteger(rateBps) ||
    rateBps<0 || rateBps>10000 || !Number.isSafeInteger((total-surcharge)*rateBps))
    throw new DriverError(409,"INVALID_LEDGER","Settlement requires finance review.");
  const gross=total;
  // The charter's platform share is calculated on the entire charter fare,
  // including the flat fee already embedded in it. Record that fee separately
  // and deduct it from commission so the passenger is never charged twice.
  const platformShare=isCharter ? calculateCharterPlatformShare(total-surcharge,rateBps) : platformFee;
  if(isCharter && platformShare<platformFee)
    throw new DriverError(409,"INVALID_LEDGER","Charter fare is too low to include the flat booking fee within the platform share.");
  const commission=isCharter ? Math.max(0,platformShare-platformFee) : 0;
  return {gross,surcharge,platformFee,commission,net:gross-platformFee-commission};
}
export async function sendPayout(payoutId:string):Promise<boolean> {
  const payout=await db.payoutRecord.findUnique({where:{id:payoutId},include:{driver:true}});
  if(!payout)return false;
  if(payout.status==="completed")return payout.settlementVerified;
  if(!["queued","failed"].includes(payout.status))return false;
  if(!Number.isSafeInteger(payout.netPayoutAmount) || payout.netPayoutAmount<1)throw new DriverError(409,"INVALID_PAYOUT","Payout requires finance review.");
  const creds=await daraja.resolveDaraja();
  const callbackBase=creds.callbackBaseUrl.replace(/\/$/,"");
  if(creds.mode!=="mock" && (!callbackBase.startsWith("https://") || !payout.ledgerEntryId))throw new DriverError(503,"PAYOUT_NOT_READY","Verified ledger linkage and HTTPS callback configuration are required.");
  if(creds.mode!=="mock") {
    if(process.env.MPESA_LIVE_PAYOUTS_ENABLED!=="true")throw new DriverError(503,"LIVE_PAYOUTS_DISABLED","Live payouts require release approval and provider verification.");
    const ledger=await db.ledgerEntry.findUnique({where:{id:payout.ledgerEntryId!},include:{refunds:true}});
    if(!ledger || ledger.status!=="driver_payable" || ledger.refunds.some(r=>r.status!=="failed"))throw new DriverError(409,"RECONCILIATION_REQUIRED","Refunds or ledger changes require finance reconciliation before payout.");
  }
  const capability=randomBytes(32).toString("hex"),originatorId=`MR-${randomBytes(8).toString("hex")}`;
  const attempt=await db.$transaction(async tx=>{
    const destination=await tx.driverPayoutDestination.findUnique({where:{driverId:payout.driverId}});
    const currentDriver=await tx.driver.findUniqueOrThrow({where:{id:payout.driverId}});
    if(!destination || destination.status!=="approved" || destination.phone!==currentDriver.mpesaNumber)throw new DriverError(409,"BENEFICIARY_NOT_APPROVED","Verify the driver's payout beneficiary before sending funds.");
    const claimed=await tx.payoutRecord.updateMany({where:{id:payoutId,status:{in:["queued","failed"]}},data:{status:"processing",failureReason:null}});
    if(claimed.count!==1)return null;
    return tx.payoutAttempt.create({data:{payoutId,callbackHash:createHash("sha256").update(capability).digest("hex"),receiverPhone:destination.phone,amount:payout.netPayoutAmount,originatorId}});
  });
  if(!attempt)return false;
  let result:daraja.DarajaResultCode;
  try { result=await daraja.b2c({receiverPhone:attempt.receiverPhone,amount:attempt.amount,originatorId,remarks:`Mireli settlement ${payoutId}`,
    resultUrl:`${callbackBase}/api/pay/mpesa/payout-result/${capability}`,timeoutUrl:`${callbackBase}/api/pay/mpesa/payout-result/${capability}?timeout=1`}); }
  catch {result={resultCode:"UNKNOWN",resultDesc:"Transfer outcome is unknown. Reconcile before retrying."};}
  const status=classifySubmission(result);
  if(status==="completed" && !isLocalDemoEnabled())throw new Error("Synchronous settlement is restricted to simulation");
  await db.$transaction(async tx=>{
    // A callback may beat the submission response. Never overwrite a terminal result.
    const current=await tx.payoutAttempt.findUnique({where:{id:attempt.id}});
    if(!current || ["confirmed","failed"].includes(current.state))return;
    await tx.payoutAttempt.update({where:{id:attempt.id},data:{state:status==="completed"?"confirmed":status,conversationId:result.conversationId??null,receipt:result.receipt??null,resultCode:result.resultCode}});
    await tx.payoutRecord.update({where:{id:payoutId},data:{status,settlementVerified:status==="completed",mpesaResultCode:result.resultCode,
      failureReason:status==="failed" || status==="ambiguous"?result.resultDesc:null,completedAt:status==="completed"?new Date():null}});
    if(status==="completed" && payout.ledgerEntryId)await tx.ledgerEntry.updateMany({where:{id:payout.ledgerEntryId,status:"driver_payable"},data:{status:"commission_taken",statusChangedAt:new Date()}});
  });
  return (await db.payoutRecord.findUnique({where:{id:payoutId},select:{settlementVerified:true}}))?.settlementVerified===true;
}

type CallbackResult={ResultCode?:string|number;ConversationID?:string;OriginatorConversationID?:string;TransactionID?:string;ResultParameters?:{ResultParameter?:{Key:string;Value?:unknown}[]}};
export async function settleCallback(capability:string,result:CallbackResult,timeout=false) {
  if(!/^[a-f0-9]{64}$/.test(capability))throw new DriverError(404,"NOT_FOUND","Settlement attempt not found.");
  const attempt=await db.payoutAttempt.findUnique({where:{callbackHash:createHash("sha256").update(capability).digest("hex")},include:{payout:true}});
  if(!attempt)throw new DriverError(404,"NOT_FOUND","Settlement attempt not found.");
  if(timeout) {
    await db.$transaction(async tx=>{
      const updated=await tx.payoutAttempt.updateMany({where:{id:attempt.id,state:{in:["submitting","processing"]}},data:{state:"ambiguous"}});
      if(updated.count)await tx.payoutRecord.update({where:{id:attempt.payoutId},data:{status:"ambiguous",failureReason:"Provider timeout. Reconciliation required before retry."}});
    });return {duplicate:false};
  }
  if(result.OriginatorConversationID!==attempt.originatorId || (attempt.conversationId && result.ConversationID!==attempt.conversationId))throw new DriverError(400,"RESULT_MISMATCH","Provider correlation does not match.");
  const parameters=result.ResultParameters?.ResultParameter||[];
  const param=(key:string)=>parameters.find(p=>p.Key===key)?.Value;
  const code=String(result.ResultCode??"");
  const receipt=typeof result.TransactionID==="string"?result.TransactionID:"";
  const amount=Number(param("TransactionAmount"));
  const receiver=String(param("ReceiverPartyPublicName")??"").replace(/^\+/,"");
  if(!/^\d+$/.test(code))throw new DriverError(400,"INVALID_RESULT","Result code is invalid.");
  const expectedReceiver=attempt.receiverPhone.replace(/^\+/,"");
  const receiverMatches=new RegExp(`^${expectedReceiver}(?:\\s|-|$)`).test(receiver);
  if(code==="0" && (!/^[A-Z0-9]{8,20}$/.test(receipt) || amount!==attempt.amount || !receiverMatches))throw new DriverError(400,"RESULT_MISMATCH","Settlement amount or recipient could not be verified.");
  return db.$transaction(async tx=>{
    const current=await tx.payoutAttempt.findUnique({where:{id:attempt.id}});
    if(!current)throw new DriverError(404,"NOT_FOUND","Settlement attempt not found.");
    if(["confirmed","failed"].includes(current.state)) {
      if(current.resultCode!==code || (code==="0" && current.receipt!==receipt))throw new DriverError(409,"RESULT_CONFLICT","Conflicting result requires reconciliation.");
      return {duplicate:true};
    }
    const claimed=await tx.payoutAttempt.updateMany({where:{id:attempt.id,state:{in:["submitting","processing","ambiguous"]}},data:{state:code==="0"?"confirmed":"failed",receipt:code==="0"?receipt:null,resultCode:code,conversationId:result.ConversationID??attempt.conversationId}});
    if(claimed.count!==1)throw new DriverError(409,"RESULT_CONFLICT","Refresh settlement state.");
    await tx.payoutRecord.update({where:{id:attempt.payoutId},data:{status:code==="0"?"completed":"failed",settlementVerified:code==="0",completedAt:code==="0"?new Date():null,mpesaResultCode:code,failureReason:code==="0"?null:"Provider reported transfer failure. Finance review required."}});
    if(code==="0" && attempt.payout.ledgerEntryId)await tx.ledgerEntry.updateMany({where:{id:attempt.payout.ledgerEntryId,status:"driver_payable"},data:{status:"commission_taken",statusChangedAt:new Date()}});
    await tx.auditLog.create({data:{actorId:"system",actorRole:"system",actorName:"Settlement service",action:"money.payout_result",entity:"payout",entityId:attempt.payoutId,metadata:JSON.stringify({attemptId:attempt.id,resultCode:code})}});
    return {duplicate:false};
  });
}
