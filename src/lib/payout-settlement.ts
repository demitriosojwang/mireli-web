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
export function calculateSettlement(total:number,surcharge:number,platformFee:number,rateBps:number,isCharter:boolean,vatAmount=0) {
  // Subtract VAT before splitting the fare. Charter VAT is added on top; the
  // motorbike and tuk-tuk schedules include VAT in the driver's gross fare.
  const fareBase=total-vatAmount;
  if(!Number.isSafeInteger(total) || total<0 || !Number.isSafeInteger(vatAmount) || vatAmount<0 || vatAmount>total ||
    !Number.isSafeInteger(surcharge) || surcharge<0 || surcharge>fareBase ||
    !Number.isSafeInteger(platformFee) || platformFee<0 || platformFee>fareBase-surcharge || !Number.isInteger(rateBps) ||
    rateBps<0 || rateBps>10000 || !Number.isSafeInteger((fareBase-surcharge)*rateBps))
    throw new DriverError(409,"INVALID_LEDGER","Settlement requires finance review.");
  const gross=fareBase;
  // The charter's platform share is calculated on the entire charter fare,
  // including one fee line embedded in it. Record the fee separately and
  // deduct it from commission so the passenger is never charged twice.
  const platformShare=isCharter ? calculateCharterPlatformShare(fareBase-surcharge,rateBps) : platformFee;
  if(isCharter && platformShare<platformFee)
    throw new DriverError(409,"INVALID_LEDGER","Charter fare is too low to include Mireli's fee within the platform share.");
  const commission=isCharter ? Math.max(0,platformShare-platformFee) : 0;
  return {gross,surcharge,platformFee,commission,net:gross-platformFee-commission};
}
export async function sendPayout(payoutId:string, request?:{driverId:string; destinationVersion:number}):Promise<boolean> {
  const payout=await db.payoutRecord.findFirst({where:{id:payoutId, ...(request && {driverId:request.driverId})}});
  if(!payout && request)throw new DriverError(404,"PAYOUT_NOT_FOUND","Settlement not found.");
  if(!payout)return false;
  if(payout.status==="completed")return payout.settlementVerified;
  const allowedStatuses=request?["queued"]:["queued","failed"];
  if(!allowedStatuses.includes(payout.status))return false;
  if(!Number.isSafeInteger(payout.netPayoutAmount) || payout.netPayoutAmount<1)throw new DriverError(409,"INVALID_PAYOUT","Payout requires finance review.");
  const creds=await daraja.resolveDaraja();
  if(request && !daraja.driverPayoutProviderReady(creds))throw new DriverError(503,"PAYOUT_NOT_READY","M-Pesa withdrawals are unavailable right now.");
  const callbackBase=creds.callbackBaseUrl.replace(/\/$/,"");
  if(creds.mode!=="mock" && (!callbackBase.startsWith("https://") || !payout.ledgerEntryId))throw new DriverError(503,"PAYOUT_NOT_READY","Verified ledger linkage and HTTPS callback configuration are required.");
  if(creds.mode!=="mock") {
    if(process.env.MPESA_LIVE_PAYOUTS_ENABLED!=="true")throw new DriverError(503,"LIVE_PAYOUTS_DISABLED","Live payouts require release approval and provider verification.");
  }
  const capability=randomBytes(32).toString("hex");
  const attempt=await db.$transaction(async tx=>{
    const config=await tx.platformConfig.findUnique({where:{id:"main"},select:{payoutMode:true}});
    const selfService=config?.payoutMode==="driver_self_service";
    if(request && !selfService)throw new DriverError(409,"WITHDRAWALS_DISABLED","Driver-initiated withdrawals are unavailable.");
    if(!request && selfService && payout.status==="queued")return null;
    if(selfService && !daraja.driverPayoutProviderReady(creds))throw new DriverError(503,"PAYOUT_NOT_READY","M-Pesa withdrawals are unavailable right now.");
    if(creds.mode!=="mock" || request) {
      const ledger=payout.ledgerEntryId && await tx.ledgerEntry.findFirst({where:{id:payout.ledgerEntryId,status:"driver_payable",refunds:{none:{status:{not:"failed"}}}}});
      if(!ledger)throw new DriverError(409,"RECONCILIATION_REQUIRED","Refunds or ledger changes require finance reconciliation before payout.");
    }
    const destination=await tx.driverPayoutDestination.findUnique({where:{driverId:payout.driverId}});
    const currentDriver=await tx.driver.findUniqueOrThrow({where:{id:payout.driverId}});
    if(!destination || destination.status!=="approved" || destination.phone!==currentDriver.mpesaNumber)throw new DriverError(409,"BENEFICIARY_NOT_APPROVED","Verify the driver's payout beneficiary before sending funds.");
    if(request && destination.version!==request.destinationVersion)throw new DriverError(409,"DESTINATION_CHANGED","Refresh your statement to confirm the current M-Pesa number.");
    const claimed=await tx.payoutRecord.updateMany({where:{id:payoutId,status:payout.status},data:{status:"processing",failureReason:null}});
    if(claimed.count!==1)return null;
    const attempt=await tx.payoutAttempt.create({data:{payoutId,callbackHash:createHash("sha256").update(capability).digest("hex"),receiverPhone:destination.phone,amount:payout.netPayoutAmount,originatorId:selfService?null:`MR-${randomBytes(8).toString("hex")}`}});
    if(request)await tx.auditLog.create({data:{actorId:request.driverId,actorRole:"driver",actorName:currentDriver.name,action:"driver.payout_requested",entity:"payout",entityId:payoutId,metadata:JSON.stringify({attemptId:attempt.id})}});
    return attempt;
  },{isolationLevel:"Serializable"});
  if(!attempt)return false;
  const originatorId=attempt.originatorId??undefined;
  let result:daraja.DarajaResultCode;
  try { result=await daraja.b2c({receiverPhone:attempt.receiverPhone,amount:attempt.amount,originatorId,apiVersion:originatorId?"v3":"v1",remarks:`Mireli settlement ${payoutId}`,
    resultUrl:`${callbackBase}/api/pay/mpesa/payout-result/${capability}`,timeoutUrl:`${callbackBase}/api/pay/mpesa/payout-result/${capability}?timeout=1`}); }
  catch {result={resultCode:"UNKNOWN",resultDesc:"Transfer outcome is unknown. Reconcile before retrying."};}
  const status=classifySubmission(result);
  if(status==="completed" && !isLocalDemoEnabled())throw new Error("Synchronous settlement is restricted to simulation");
  await db.$transaction(async tx=>{
    // A callback or queue timeout may beat the submission response.
    const submitted=await tx.payoutAttempt.updateMany({where:{id:attempt.id,state:"submitting"},data:{state:status==="completed"?"confirmed":status,conversationId:result.conversationId??null,originatorId:result.originatorId??originatorId,receipt:result.receipt??null,resultCode:result.resultCode}});
    if(!submitted.count)return;
    const failureReason=status==="failed"?"M-Pesa declined the transfer. Finance review is required.":
      status==="ambiguous"?"M-Pesa did not confirm the transfer outcome. Finance review is required.":null;
    await tx.payoutRecord.update({where:{id:payoutId},data:{status,settlementVerified:status==="completed",mpesaResultCode:result.resultCode,
      failureReason,completedAt:status==="completed"?new Date():null}});
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
  const originatorId=result.OriginatorConversationID,conversationId=result.ConversationID;
  if(!originatorId || !conversationId || (attempt.originatorId && originatorId!==attempt.originatorId) || (attempt.conversationId && conversationId!==attempt.conversationId))throw new DriverError(400,"RESULT_MISMATCH","Provider correlation does not match.");
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
    if((current.originatorId && current.originatorId!==originatorId) || (current.conversationId && current.conversationId!==conversationId))throw new DriverError(400,"RESULT_MISMATCH","Provider correlation does not match.");
    const claimed=await tx.payoutAttempt.updateMany({where:{id:attempt.id,state:{in:["submitting","processing","ambiguous"]},originatorId:current.originatorId,conversationId:current.conversationId},data:{state:code==="0"?"confirmed":"failed",receipt:code==="0"?receipt:null,resultCode:code,conversationId,originatorId}});
    if(claimed.count!==1)throw new DriverError(409,"RESULT_CONFLICT","Refresh settlement state.");
    await tx.payoutRecord.update({where:{id:attempt.payoutId},data:{status:code==="0"?"completed":"failed",settlementVerified:code==="0",completedAt:code==="0"?new Date():null,mpesaResultCode:code,failureReason:code==="0"?null:"Provider reported transfer failure. Finance review required."}});
    if(code==="0" && attempt.payout.ledgerEntryId)await tx.ledgerEntry.updateMany({where:{id:attempt.payout.ledgerEntryId,status:"driver_payable"},data:{status:"commission_taken",statusChangedAt:new Date()}});
    await tx.auditLog.create({data:{actorId:"system",actorRole:"system",actorName:"Settlement service",action:"money.payout_result",entity:"payout",entityId:attempt.payoutId,metadata:JSON.stringify({attemptId:attempt.id,resultCode:code})}});
    return {duplicate:false};
  });
}
