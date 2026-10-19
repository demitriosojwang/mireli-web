import {createHash} from "node:crypto";
import {Prisma} from "@prisma/client";
import {db} from "@/lib/db";
import {DriverError,integer,text} from "./errors";
import {evaluateDriverApplication} from "./eligibility";
import {settleCompletedTrip} from "@/lib/money";

const visibleStatuses=["confirmed","boarded","completed","no_show"];
const conflict=()=>new DriverError(409,"TRIP_CHANGED","This assignment changed. Refresh before continuing.");
const include={route:{include:{stages:{orderBy:{order:"asc" as const}}}},bookings:{where:{status:{in:visibleStatuses}},include:{passenger:true}},driverProgress:true};
type TripRecord=Prisma.TripGetPayload<{include:typeof include}>;
export function boardingCounts(b:{status:string;seats:number;boardedSeats:number;noShowSeats:number}) {
  const boarded=b.boardedSeats || (b.status==="boarded" && !b.noShowSeats?b.seats:0);
  const noShow=b.noShowSeats || (b.status==="no_show"?b.seats:0);
  return {boarded,noShow,remaining:b.seats-boarded-noShow};
}
function tripDto(t:TripRecord,driverId:string,eligible:boolean) {
  const progress=t.driverProgress.find(p=>p.driverId===driverId);
  const phase=t.status==="completed"?"completed":t.status==="cancelled"?"cancelled":t.status==="departed"?"in_progress":progress?.phase??"assigned";
  const active=t.status!=="completed" && t.status!=="cancelled";
  const contact=active && eligible && ["accepted","at_pickup","in_progress"].includes(phase);
  return {id:t.id,version:progress?.version??0,phase,status:t.status,routeName:t.route.name,direction:t.direction,
    departureAt:t.departureAt,capacity:t.capacity,serviceType:t.bookings.some(b=>b.isCharter)?"charter":"shared",
    stages:t.route.stages.map(s=>({id:s.id,order:s.order,name:s.name,latitude:s.lat,longitude:s.lng})),
    passengers:active&&eligible?t.bookings.map(b=>({id:b.id,name:b.passengerName||b.passenger.name||"Passenger",seats:b.seats,status:b.status,
      ...boardingCounts(b),stageId:b.stageId,stageName:b.stageName,homePickup:b.homePickup,homeAddress:contact?b.homeAddress:null,
      phone:contact?(b.passengerPhone||b.passenger.phone):null})):[],
    // Boarding codes are supplied by passengers, never returned on the manifest.
    contactAvailable:contact};
}
export async function driverTrips(driverId:string) {
  const app=await db.driverApplication.findUnique({where:{driverId},include:{driver:true,documents:{where:{state:{not:"replaced"}}}}});
  const eligibility=evaluateDriverApplication(app,app?.driver.status??"applicant");
  const trips=await db.trip.findMany({where:{driverId,OR:[{status:{in:["scheduled","locked","departed"]}},{departureAt:{gte:new Date(Date.now()-30*86400000)}}]},include,orderBy:{departureAt:"asc"},take:50});
  return {serverTime:new Date(),eligibility,trips:trips.map(t=>tripDto(t,driverId,eligibility.eligible))};
}
export async function driverTripCommand(driverId:string,tripId:string,body:Record<string,unknown>) {
  text(tripId,"Trip",4,80);
  const clientActionId=text(body.clientActionId,"Action ID",16,100),expectedVersion=integer(body.expectedVersion,"Version");
  const action=text(body.action,"Action",4,20);
  if(!["accept","decline","arrive","board","no_show","start","complete"].includes(action))throw new DriverError(400,"INVALID_ACTION","Unknown trip action.");
  const bookingId=["board","no_show"].includes(action)?text(body.bookingId,"Booking",4,80):null;
  const count=action==="board"?integer(body.count,"Boarding count",1,60):null;
  const code=action==="board"?text(body.code,"Boarding code",4,40).toUpperCase():null;
  const reason=["decline","no_show"].includes(action)?text(body.reason,"Reason",5,200):null;
  const requestHash=createHash("sha256").update(JSON.stringify({tripId,expectedVersion,action,bookingId,count,code,reason})).digest("hex");
  async function transact() {
    return db.$transaction(async tx=>{
      const existing=await tx.driverTripAction.findUnique({where:{driverId_clientActionId:{driverId,clientActionId}}});
      if(existing){if(existing.requestHash!==requestHash)throw new DriverError(409,"ACTION_REUSED","This action ID was used for another request.");return JSON.parse(existing.result);}
      const trip=await tx.trip.findFirst({where:{id:tripId,driverId},include:{bookings:{where:{status:{in:visibleStatuses}},include:{ledgerEntry:true}}}});
      if(!trip)throw new DriverError(404,"ASSIGNMENT_NOT_FOUND","This trip is not assigned to your account.");
      if(!["scheduled","locked","departed"].includes(trip.status))throw conflict();
      const progress=await tx.driverTripProgress.upsert({where:{tripId_driverId:{tripId,driverId}},create:{tripId,driverId},update:{}});
      if(progress.version!==expectedVersion)throw conflict();
      const phase=trip.status==="departed"?"in_progress":progress.phase;
      if(action!=="complete") {
        const app=await tx.driverApplication.findUnique({where:{driverId},include:{driver:true,documents:{where:{state:{not:"replaced"}}}}});
        if(!evaluateDriverApplication(app,app?.driver.status??"applicant").eligible)throw new DriverError(403,"DRIVER_INELIGIBLE","Current compliance approval is required. Contact support about existing journeys.");
      }
      const allowed:Record<string,string[]>={accept:["assigned"],decline:["assigned"],arrive:["accepted"],board:["at_pickup"],no_show:["at_pickup"],start:["at_pickup"],complete:["in_progress"]};
      if(!allowed[action].includes(phase))throw new DriverError(409,"WRONG_STAGE","This action is not available at this trip stage.");
      let next=phase;
      // Claim both assignment and version before changing boarding or settlement.
      const claim=await tx.driverTripProgress.updateMany({where:{id:progress.id,version:expectedVersion},data:{version:{increment:1}}});
      if(claim.count!==1)throw conflict();
      const owned=await tx.trip.updateMany({where:{id:tripId,driverId,status:trip.status},data:{driverId}});
      if(owned.count!==1)throw conflict();
      if(action==="accept"){next="accepted";await tx.driverTripProgress.update({where:{id:progress.id},data:{acceptedAt:new Date()}});}
      if(action==="decline") {
        next="declined";
        await tx.trip.update({where:{id:tripId},data:{driverId:null}});
        await tx.driverTripProgress.update({where:{id:progress.id},data:{declineReason:reason}});
      }
      if(action==="arrive"){next="at_pickup";await tx.driverTripProgress.update({where:{id:progress.id},data:{arrivedAt:new Date()}});}
      if(action==="board" || action==="no_show") {
        const b=trip.bookings.find(b=>b.id===bookingId);
        if(!b || b.status!=="confirmed")throw new DriverError(409,"BOOKING_CHANGED","This booking is no longer waiting for boarding.");
        const counts=boardingCounts(b);
        if(counts.remaining<=0)throw conflict();
        if(action==="board") {
          if(code!==b.code.toUpperCase())throw new DriverError(400,"BOARDING_CODE_MISMATCH","The passenger's boarding code does not match.");
          if(count!>counts.remaining)throw new DriverError(400,"INVALID_COUNT","The boarding count exceeds the remaining seats.");
          if(!b.ledgerEntry || b.ledgerEntry.status!=="held")throw new DriverError(409,"PAYMENT_NOT_READY","This booking does not have a confirmed fare hold.");
          await tx.booking.update({where:{id:b.id},data:{boardedSeats:counts.boarded+count!,status:count===counts.remaining?"boarded":"confirmed",checkedInAt:new Date()}});
        }else {
          if(new Date()<trip.departureAt)throw new DriverError(409,"NO_SHOW_TOO_EARLY","A no-show can be reported only after the scheduled departure time.");
          await tx.booking.update({where:{id:b.id},data:{noShowSeats:counts.noShow+counts.remaining,noShowReason:reason,status:counts.boarded>0?"boarded":"no_show"}});
          // The driver records attendance; operations resolves held passenger funds.
          await tx.driverSupportCase.create({data:{driverId,clientActionId:`no-show-${clientActionId}`,category:"trip",message:`No-show reported on trip ${tripId}, booking ${b.id}: ${counts.remaining} seats. ${reason}. Held fare requires operations review.`}});
        }
      }
      if(action==="start") {
        if(trip.bookings.some(b=>boardingCounts(b).remaining>0))throw new DriverError(409,"UNRESOLVED_MANIFEST","Resolve every confirmed passenger seat before starting.");
        const boarded=trip.bookings.reduce((total,b)=>total+boardingCounts(b).boarded,0);
        if(boarded===0 || boarded>trip.capacity)throw new DriverError(409,"INVALID_MANIFEST","Check the boarding count and vehicle capacity with dispatch.");
        if(trip.departureAt.getTime()>Date.now()+15*60000)throw new DriverError(409,"TOO_EARLY","Start is available within 15 minutes of the scheduled departure.");
        if(await tx.trip.count({where:{driverId,status:"departed",id:{not:tripId}}}))throw new DriverError(409,"OTHER_TRIP_ACTIVE","Finish your current journey before starting another.");
        next="in_progress";await tx.trip.update({where:{id:tripId},data:{status:"departed",departedAt:new Date()}});
      }
      if(action==="complete") {
        const cfg=await tx.platformConfig.findUnique({where:{id:"main"}});
        if(!cfg)throw new DriverError(503,"SETTLEMENT_NOT_CONFIGURED","Settlement configuration needs operations review.");
        await settleCompletedTrip(tx,tripId,cfg.commissionRate);next="completed";
      }
      await tx.driverTripProgress.update({where:{id:progress.id},data:{phase:next}});
      const result={tripId,version:expectedVersion+1,phase:next};
      await tx.driverTripAction.create({data:{driverId,tripId,clientActionId,requestHash,result:JSON.stringify(result)}});
      await tx.auditLog.create({data:{actorId:driverId,actorName:"Driver",actorRole:"driver",action:`driver.trip_${action}`,entity:"trip",entityId:tripId,metadata:JSON.stringify({bookingId,count,reason,clientActionId,version:result.version})}});
      return result;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  }
  for(let attempt=0;attempt<3;attempt++){
    try{return await transact();}catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError && ["P2034","P2002"].includes(error.code) && attempt<2)continue;throw error;}
  }
}
