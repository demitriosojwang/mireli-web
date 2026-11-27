import {db} from "@/lib/db";
import {DriverError,integer,text} from "./errors";
import {isLocalDemoEnabled} from "@/lib/runtime-mode";
import {driverPayoutProviderReady,resolveDaraja} from "@/lib/daraja";
import {sendPayout} from "@/lib/payout-settlement";

export async function requestDriverPayout(driverId:string,body:Record<string,unknown>) {
  const payoutId=text(body.payoutId,"Settlement",4,80);
  const destinationVersion=integer(body.destinationVersion,"Payout destination version");
  await sendPayout(payoutId,{driverId,destinationVersion});
  const payout=await db.payoutRecord.findFirstOrThrow({where:{id:payoutId,driverId},select:{status:true,settlementVerified:true}});
  return {status:payout.status==="completed" && !payout.settlementVerified?"needs_review":payout.status};
}

export function minor(ksh:number):number {
  if(!Number.isSafeInteger(ksh) || !Number.isSafeInteger(ksh*100)) throw new DriverError(503,"INVALID_LEDGER","The statement needs finance review.");
  return ksh*100;
}
export async function driverEarnings(driverId:string,url:URL) {
  const cursor=url.searchParams.get("cursor");
  const [rows,totals,driver,config]=await Promise.all([
    db.payoutRecord.findMany({where:{driverId},orderBy:[{initiatedAt:"desc"},{id:"desc"}],take:51,
      ...(cursor?{cursor:{id:cursor},skip:1}:{}),include:{trip:{include:{route:{select:{name:true}},bookings:{select:{isCharter:true}}}}}}),
    db.payoutRecord.groupBy({by:["status","settlementVerified"],where:{driverId},_sum:{netPayoutAmount:true,grossFareTotal:true,commissionAmount:true,platformFeeAmount:true,homeSurchargeAmount:true},_count:{id:true}}),
    db.driver.findUnique({where:{id:driverId},select:{mpesaNumber:true,payoutDestination:{select:{phone:true,status:true,version:true,accountName:true,reviewNote:true}}}}),
    db.platformConfig.findUnique({where:{id:"main"},select:{payoutMode:true}}),
  ]);
  if(cursor) {const owned=await db.payoutRecord.findFirst({where:{id:cursor,driverId},select:{id:true}});if(!owned)throw new DriverError(400,"INVALID_CURSOR","Statement cursor is invalid.");}
  const status=(state:string,verified:boolean)=>state==="completed"&&!verified?"needs_review":state;
  const {phone,...destination}=driver?.payoutDestination??{phone:null,status:"not_configured",version:0};
  const canWithdraw=config?.payoutMode==="driver_self_service" && destination.status==="approved" && phone===driver?.mpesaNumber &&
    await resolveDaraja().then(driverPayoutProviderReady).catch(()=>false);
  const candidates=rows.slice(0,50).flatMap(p=>p.status==="queued" && p.netPayoutAmount>0 && p.ledgerEntryId?[p.ledgerEntryId]:[]);
  const available=new Set(canWithdraw && candidates.length? (await db.ledgerEntry.findMany({where:{id:{in:candidates},status:"driver_payable",refunds:{none:{status:{not:"failed"}}}},select:{id:true}})).map(entry=>entry.id):[]);
  return {currency:"KES",unit:"minor",simulation:isLocalDemoEnabled(),destinationMasked:driver?.mpesaNumber.replace(/.(?=.{4})/g,"•"),
    destination,
    totals:totals.map(t=>({status:status(t.status,t.settlementVerified),count:t._count.id,netMinor:minor(t._sum.netPayoutAmount??0),grossMinor:minor(t._sum.grossFareTotal??0),commissionMinor:minor(t._sum.commissionAmount??0),platformFeeMinor:minor(t._sum.platformFeeAmount??0),surchargeMinor:minor(t._sum.homeSurchargeAmount??0)})),
    lines:rows.slice(0,50).map(p=>({id:p.id,tripId:p.tripId,routeName:p.trip?.route.name??"Adjustment",serviceType:p.trip?.bookings.some(b=>b.isCharter)?"charter":"shared",grossMinor:minor(p.grossFareTotal),commissionMinor:minor(p.commissionAmount),platformFeeMinor:minor(p.platformFeeAmount),surchargeMinor:minor(p.homeSurchargeAmount),netMinor:minor(p.netPayoutAmount),status:status(p.status,p.settlementVerified),withdrawable:p.status==="queued" && p.netPayoutAmount>0 && available.has(p.ledgerEntryId??""),failureReason:p.failureReason,initiatedAt:p.initiatedAt,completedAt:p.completedAt})),
    nextCursor:rows.length>50?rows[49].id:null,serverTime:new Date(),note:"A statement of settlement records. Pending or processing amounts are not paid funds."};
}
