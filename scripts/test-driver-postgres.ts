import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {db} from "../src/lib/db";
import {driverTripCommand,driverTrips} from "../src/lib/driver/trips";
import {requirements,POLICY_VERSION} from "../src/lib/driver/catalogue";
import {requestPayoutDestination,reviewPayoutDestination} from "../src/lib/driver/beneficiary";
import {executePayout} from "../src/lib/money";
async function main(){
  if(process.env.DATABASE_URL!=="postgresql://mireli_test@127.0.0.1:55433/mireli_test" || process.env.NODE_ENV!=="development" || process.env.MIRELI_DEMO_MODE!=="true" || process.env.MPESA_MODE!=="mock" || process.env.VERCEL)throw new Error("Refused: only the isolated synthetic PostgreSQL fixture is permitted.");
  const tag=randomBytes(6).toString("hex");
  try{
    await db.platformConfig.upsert({where:{id:"main"},create:{id:"main"},update:{}});
    const driver=await db.driver.create({data:{name:"Synthetic PostgreSQL Driver",phone:`+254700${Date.now().toString().slice(-6)}`,mpesaNumber:"+254700000000",plate:"DEMO PG",cabType:"Shuttle",capacity:10,status:"active",application:{create:{status:"approved",policyVersion:POLICY_VERSION,licenceClass:"D1",ownsVehicle:true,documents:{create:requirements.map(r=>({type:r.id,objectKey:`SYNTHETIC-${tag}-${r.id}`,mime:"application/pdf",bytes:10,sha256:"synthetic",state:"approved",scanState:"clean_demo",expiresAt:r.expires?new Date("2028-12-31"):null}))}}}}});
    const other=await db.driver.create({data:{name:"Synthetic Other Driver",phone:`OTHER-${tag}`,mpesaNumber:"",plate:"DEMO",cabType:"Shuttle",capacity:10}});
    const route=await db.route.create({data:{name:`Synthetic PG Route ${tag}`,durationMinutes:30,charterPrice:1000}});
    const passenger=await db.passenger.create({data:{phone:`SYNTHETIC-${tag}`,name:"Synthetic passenger"}});
    const trip=await db.trip.create({data:{driverId:driver.id,routeId:route.id,direction:"FROM_TERMINUS",capacity:10,departureAt:new Date(),status:"locked"}});
    const booking=await db.booking.create({data:{passengerId:passenger.id,tripId:trip.id,routeId:route.id,direction:"FROM_TERMINUS",code:`TEST-${tag}`,seats:2,fareAmount:1000,homeSurcharge:0,creditApplied:0,cashDue:1000,status:"confirmed",ledgerEntry:{create:{tripId:trip.id,totalAmount:1000,cashAmount:1000,creditApplied:0,homeSurchargeAmount:0,status:"held"}}}});
    const accept={action:"accept",expectedVersion:0,clientActionId:randomBytes(16).toString("hex")};
    await assert.rejects(driverTripCommand(other.id,trip.id,accept),/assigned/);
    const accepted=await Promise.all([driverTripCommand(driver.id,trip.id,accept),driverTripCommand(driver.id,trip.id,accept)]);assert.deepEqual(accepted[0],accepted[1]);
    await driverTripCommand(driver.id,trip.id,{action:"arrive",expectedVersion:1,clientActionId:randomBytes(16).toString("hex")});
    const board={action:"board",expectedVersion:2,clientActionId:randomBytes(16).toString("hex"),bookingId:booking.id,code:booking.code,count:2};
    await Promise.all([driverTripCommand(driver.id,trip.id,board),driverTripCommand(driver.id,trip.id,board)]);
    assert.equal((await db.booking.findUniqueOrThrow({where:{id:booking.id}})).boardedSeats,2);
    await driverTripCommand(driver.id,trip.id,{action:"start",expectedVersion:3,clientActionId:randomBytes(16).toString("hex")});
    const complete={action:"complete",expectedVersion:4,clientActionId:randomBytes(16).toString("hex")};
    await Promise.all([driverTripCommand(driver.id,trip.id,complete),driverTripCommand(driver.id,trip.id,complete)]);
    assert.equal(await db.payoutRecord.count({where:{tripId:trip.id}}),1);
    assert.equal((await driverTrips(driver.id)).trips.find(t=>t.id===trip.id)!.passengers.length,0);
    await requestPayoutDestination(driver.id,{expectedVersion:0,accountName:driver.name,acknowledged:true});
    const dest=await db.driverPayoutDestination.findUniqueOrThrow({where:{driverId:driver.id}});
    await reviewPayoutDestination({id:dest.id,expectedVersion:0,action:"approve",note:"Synthetic test verification only."},{id:"SYNTHETIC-reviewer",name:"Synthetic reviewer"});
    const payout=await db.payoutRecord.findFirstOrThrow({where:{tripId:trip.id}});
    await Promise.all([executePayout(payout.id),executePayout(payout.id)]);
    assert.equal(await db.payoutAttempt.count({where:{payoutId:payout.id}}),1);
    assert.equal((await db.payoutRecord.findUniqueOrThrow({where:{id:payout.id}})).settlementVerified,true);
    console.log("PASS: PostgreSQL ownership, concurrent command replay, single boarding count, single completion settlement and single simulated transfer attempt. Synthetic fixture retained.");
  }finally{await db.$disconnect();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:"PostgreSQL validation failed");process.exitCode=1;});
