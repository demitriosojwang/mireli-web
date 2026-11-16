import type {Prisma} from "@prisma/client";
import {addNairobiDays, nairobiDate, nairobiDayRange, nairobiWeekday} from "@/lib/nairobi-time";
import {db} from "@/lib/db";
import {DriverError} from "./errors";
import {isLocalDemoEnabled} from "@/lib/runtime-mode";

export function minor(ksh:number):number {
  if(!Number.isSafeInteger(ksh) || !Number.isSafeInteger(ksh*100)) throw new DriverError(503,"INVALID_LEDGER","The statement needs finance review.");
  return ksh*100;
}
export async function driverEarnings(driverId:string,url:URL) {
  const cursor=url.searchParams.get("cursor");
  const now = new Date();
  const today = nairobiDate(now);
  const weekStart = nairobiDayRange(addNairobiDays(today, -((nairobiWeekday(today) + 6) % 7))).start;
  const monthStart = nairobiDayRange(today.slice(0, 7) + "-01").start;
  function groupTotals(where: Prisma.PayoutRecordWhereInput) {
    return db.payoutRecord.groupBy({by:["status","settlementVerified"],where:{driverId,...where},
      _sum:{netPayoutAmount:true,grossFareTotal:true,commissionAmount:true,platformFeeAmount:true,homeSurchargeAmount:true},_count:{id:true}});
  }
  function inPeriod(start: Date): Prisma.PayoutRecordWhereInput {
    const range = {gte:start,lte:now};
    return {OR:[
      {status:"completed",settlementVerified:true,completedAt:range},
      {NOT:{status:"completed",settlementVerified:true},initiatedAt:range},
    ]};
  }
  const [rows,totals,driver,week,month]=await Promise.all([
    db.payoutRecord.findMany({where:{driverId},orderBy:[{initiatedAt:"desc"},{id:"desc"}],take:51,
      ...(cursor?{cursor:{id:cursor},skip:1}:{}),include:{trip:{include:{route:{select:{name:true}},bookings:{select:{isCharter:true}}}}}}),
    groupTotals({}),
    db.driver.findUnique({where:{id:driverId},select:{mpesaNumber:true,payoutDestination:{select:{phone:true,status:true,version:true,accountName:true,reviewNote:true}}}}),
    cursor ? undefined : groupTotals(inPeriod(weekStart)),
    cursor ? undefined : groupTotals(inPeriod(monthStart)),
  ]);
  if(cursor) {const owned=await db.payoutRecord.findFirst({where:{id:cursor,driverId},select:{id:true}});if(!owned)throw new DriverError(400,"INVALID_CURSOR","Statement cursor is invalid.");}
  const status=(state:string,verified:boolean)=>state==="completed"&&!verified?"needs_review":state;
  const formatTotals = (rows: typeof totals) => rows.map(t=>({status:status(t.status,t.settlementVerified),count:t._count.id,netMinor:minor(t._sum.netPayoutAmount??0),grossMinor:minor(t._sum.grossFareTotal??0),commissionMinor:minor(t._sum.commissionAmount??0),platformFeeMinor:minor(t._sum.platformFeeAmount??0),surchargeMinor:minor(t._sum.homeSurchargeAmount??0)}));
  const destination = driver?.payoutDestination;
  const destinationPhone = destination?.phone ?? driver?.mpesaNumber;
  return {currency:"KES",unit:"minor",simulation:isLocalDemoEnabled(),destinationMasked:destinationPhone?.replace(/.(?=.{4})/g,"•"),payoutDestinationPhoneEditable:true,
    destination:destination ? {status:destination.status,version:destination.version,accountName:destination.accountName,reviewNote:destination.reviewNote} : {status:"not_configured",version:0},
    totals:formatTotals(totals),
    ...(week && month ? {periodTotals:{week:formatTotals(week),month:formatTotals(month)}} : {}),
    lines:rows.slice(0,50).map(p=>({id:p.id,tripId:p.tripId,routeName:p.trip?.route.name??"Adjustment",serviceType:p.trip?.bookings.some(b=>b.isCharter)?"charter":"shared",grossMinor:minor(p.grossFareTotal),commissionMinor:minor(p.commissionAmount),platformFeeMinor:minor(p.platformFeeAmount),surchargeMinor:minor(p.homeSurchargeAmount),netMinor:minor(p.netPayoutAmount),status:status(p.status,p.settlementVerified),failureReason:p.failureReason,initiatedAt:p.initiatedAt,completedAt:p.completedAt})),
    nextCursor:rows.length>50?rows[49].id:null,serverTime:now,note:"A statement of settlement records. Pending or processing amounts are not paid funds."};
}
