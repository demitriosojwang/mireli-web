import {createHmac} from "node:crypto";
import {isIP} from "node:net";
import {db} from "@/lib/db";
import {DriverError} from "./errors";
import {amazonLocationConfigured, calculateAmazonDriverRoute, noFerryFreeRoute} from "./amazon-location";

type Coordinate={latitude:number;longitude:number};
type Maneuver={instruction:string;distanceMeters:number;durationSeconds:number;beginShapeIndex:number;endShapeIndex:number};

const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
function coordinate(value:unknown,name:string):Coordinate {
  const point=object(value),latitude=point?.latitude,longitude=point?.longitude;
  if(typeof latitude!=="number"||!Number.isFinite(latitude)||latitude < -5.2||latitude > -2.0||
    typeof longitude!=="number"||!Number.isFinite(longitude)||longitude < 38.0||longitude > 42.2||latitude===0&&longitude===0)
    throw new DriverError(400,"INVALID_COORDINATE",`${name} is outside the supported route area.`);
  return {latitude,longitude};
}
function metersBetween(a:Coordinate,b:Coordinate) {
  const radians=(value:number)=>value*Math.PI/180,lat1=radians(a.latitude),lat2=radians(b.latitude),dLat=lat2-lat1,dLon=radians(b.longitude-a.longitude);
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 12710000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}

/** Convert only the small, supported Valhalla response surface into app-safe data. */
export function normalizeValhallaRoute(value:unknown, avoidFerries = false) {
  const root=object(value),trip=object(root?.trip),legs=trip?.legs;
  if(!Array.isArray(legs)||legs.length!==1)throw new DriverError(502,"ROUTE_UNAVAILABLE","A driving route could not be calculated.");
  const leg=object(legs[0]),summary=object(leg?.summary),shape=leg?.shape;
  const distanceKm=summary?.length,timeSeconds=summary?.time;
  if(typeof shape!=="string"||shape.length<4||shape.length>180000||typeof distanceKm!=="number"||!Number.isFinite(distanceKm)||distanceKm<=0||distanceKm>500||
    typeof timeSeconds!=="number"||!Number.isFinite(timeSeconds)||timeSeconds<=0||timeSeconds>86400)
    throw new DriverError(502,"ROUTE_UNAVAILABLE","A driving route could not be calculated.");
  const raw=leg?.maneuvers;
  if(!Array.isArray(raw)||raw.length<1||raw.length>120)throw new DriverError(502,"ROUTE_UNAVAILABLE","Route guidance is unavailable.");
  const includesFerry = object(trip?.summary)?.has_ferry === true || summary?.has_ferry === true ||
    raw.some(item => { const step = object(item); return step?.ferry === true || step?.type === 28 || step?.type === 29; });
  if (avoidFerries && includesFerry) throw noFerryFreeRoute();
  const maneuvers:Maneuver[]=[];
  for(const item of raw){
    const row=object(item),instruction=row?.instruction,length=row?.length,time=row?.time,begin=row?.begin_shape_index,end=row?.end_shape_index;
    if(typeof instruction!=="string"||typeof length!=="number"||!Number.isFinite(length)||typeof time!=="number"||!Number.isFinite(time)||
      typeof begin!=="number"||!Number.isInteger(begin)||typeof end!=="number"||!Number.isInteger(end)||instruction.length>240||instruction.length===0)continue;
    maneuvers.push({instruction:instruction.replace(/[\u0000-\u001f\u007f]/g," ").slice(0,240),distanceMeters:Math.max(0,Math.round(length*1000)),
      durationSeconds:Math.max(0,Math.round(time)),beginShapeIndex:begin as number,endShapeIndex:end as number});
  }
  if(!maneuvers.length)throw new DriverError(502,"ROUTE_UNAVAILABLE","Route guidance is unavailable.");
  return {provider:"valhalla",geometry:shape,distanceMeters:Math.round(distanceKm*1000),durationSeconds:Math.round(timeSeconds),...(includesFerry ? { includesFerry } : {}),maneuvers};
}

function rateKey(driverId:string) {
  const secret=process.env.DRIVER_AUTH_SECRET;
  if(!secret||secret.length<32)throw new DriverError(503,"NAVIGATION_NOT_CONFIGURED","In-app routing is temporarily unavailable.");
  return createHmac("sha256",secret).update(driverId).digest("hex");
}
export async function enforceRouteLimit(driverId:string, kind="route", perDriver=30, globalMax=1200) {
  const now=Date.now(),bucket=Math.floor(now/60000),driverKey=`nav:${kind}:${rateKey(driverId)}:${bucket}`;
  const globalKey=`nav:${kind}:global:${bucket}`;
  const [driver,global]=await Promise.all([
    db.driverRateLimit.upsert({where:{key:driverKey},create:{key:driverKey,expiresAt:new Date((bucket+2)*60000)},update:{count:{increment:1}}}),
    db.driverRateLimit.upsert({where:{key:globalKey},create:{key:globalKey,expiresAt:new Date((bucket+2)*60000)},update:{count:{increment:1}}}),
  ]);
  if(driver.count>perDriver||global.count>globalMax)throw new DriverError(429,"ROUTE_RATE_LIMITED","Please wait before requesting more map data.");
  // Keep the shared limiter table bounded without adding a cleanup job dependency.
  if(bucket%10===0){
    const cleanupKey=`nav:cleanup:${Math.floor(bucket/10)}`;
    const cleanup=await db.driverRateLimit.upsert({where:{key:cleanupKey},create:{key:cleanupKey,expiresAt:new Date((bucket+20)*60000)},update:{count:{increment:1}}});
    if(cleanup.count===1)await db.driverRateLimit.deleteMany({where:{key:{startsWith:"nav:"},expiresAt:{lt:new Date(now-60000)}}});
  }
}

export function navigationRoutingConfigured() {
  return amazonLocationConfigured() || valhallaConfigured();
}

function valhallaConfigured() {
  const raw=process.env.VALHALLA_URL;
  if(!raw)return false;
  const token=process.env.VALHALLA_API_TOKEN;
  if(!token||token.length<32)return false;
  try {const url=new URL(raw);return url.protocol==="https:"&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname.endsWith("/route")&&
    !isIP(url.hostname)&&url.hostname!=="localhost"&&!url.hostname.endsWith(".local");}
  catch{return false;}
}

async function boundedRouteResponse(response:Response,maxBytes=2_000_000) {
  const reader=response.body?.getReader();
  if(!reader)throw new DriverError(502,"ROUTE_RESPONSE_INVALID","Route guidance returned an invalid response.");
  const chunks:Uint8Array[]=[];let size=0;
  try {
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>maxBytes){await reader.cancel();throw new DriverError(502,"ROUTE_RESPONSE_INVALID","Route guidance returned an invalid response.");}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  return Buffer.concat(chunks).toString("utf8");
}

export async function requestDriverRoute(driverId:string,input:Record<string,unknown>) {
  if(!navigationRoutingConfigured())throw new DriverError(503,"NAVIGATION_NOT_CONFIGURED","In-app route guidance is not connected yet. Use the agreed route and contact dispatch if needed.");
  const tripId=input.tripId,stageId=input.stageId;
  if(typeof tripId!=="string"||tripId.length<4||tripId.length>80||typeof stageId!=="string"||stageId.length<4||stageId.length>80)
    throw new DriverError(400,"INVALID_ROUTE_TARGET","Choose a stop on your assigned trip.");
  const origin=coordinate(input.origin,"Your location");
  const trip=await db.trip.findFirst({where:{id:tripId,driverId,status:{in:["scheduled","locked","departed"]}},select:{id:true,route:{select:{stages:{select:{id:true,lat:true,lng:true}}}}}});
  const targetRow=trip?.route.stages.find(stage=>stage.id===stageId);
  if(!targetRow)throw new DriverError(404,"ROUTE_TARGET_NOT_FOUND","That stop is not part of an active assignment on your account.");
  const target=coordinate({latitude:targetRow.lat,longitude:targetRow.lng},"Assigned stop");
  if(metersBetween(origin,target)>300000)throw new DriverError(400,"ROUTE_TOO_FAR","This route is outside the supported Mombasa service area.");
  await enforceRouteLimit(driverId);
  const avoidFerries = input.avoidFerries === true;
  if (!valhallaConfigured()) return calculateAmazonDriverRoute(origin, target, avoidFerries);
  const endpoint=process.env.VALHALLA_URL!;
  const headers:Record<string,string>={"content-type":"application/json",accept:"application/json"};
  if(process.env.VALHALLA_API_TOKEN)headers.authorization=`Bearer ${process.env.VALHALLA_API_TOKEN}`;
  let response:Response;
  try {
    response=await fetch(endpoint,{method:"POST",headers,redirect:"error",signal:AbortSignal.timeout(12000),body:JSON.stringify({locations:[
      {lat:origin.latitude,lon:origin.longitude,type:"break"},{lat:target.latitude,lon:target.longitude,type:"break"}],costing:"auto",...(avoidFerries ? {costing_options:{auto:{use_ferry:0}}} : {}),units:"kilometers",directions_options:{units:"kilometers",language:"en-US"}})});
  } catch {throw new DriverError(502,"ROUTE_PROVIDER_UNAVAILABLE","Route guidance could not connect. Try again or use your map app.");}
  if(!response.ok)throw new DriverError(502,"ROUTE_PROVIDER_UNAVAILABLE","Route guidance could not calculate this drive. Try again or use your map app.");
  let payload:unknown;
  try {payload=JSON.parse(await boundedRouteResponse(response));}catch(error){
    if(error instanceof DriverError)throw error;
    throw new DriverError(502,"ROUTE_RESPONSE_INVALID","Route guidance returned an invalid response.");
  }
  return normalizeValhallaRoute(payload, avoidFerries);
}

export async function requestDestinationRoute(driverId: string, input: Record<string, unknown>) {
  if (!amazonLocationConfigured()) throw new DriverError(503, "NAVIGATION_NOT_CONFIGURED", "In-app routing is unavailable. Open Google Maps to continue.");
  function kenyaPoint(value: unknown): Coordinate {
    const point = object(value);
    const lat = point?.latitude, lon = point?.longitude;
    if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < -4.9 || lat > 5.2 || lon < 33.8 || lon > 42.1) {
      throw new DriverError(400, "INVALID_COORDINATE", "Choose a location within the supported Kenya map area.");
    }
    return {latitude:lat,longitude:lon};
  }
  const origin = kenyaPoint(input.origin), destination = kenyaPoint(input.destination);
  if (metersBetween(origin, destination) > 500_000) throw new DriverError(400, "ROUTE_TOO_FAR", "Open Google Maps for destinations more than 500 km away.");
  await enforceRouteLimit(driverId, "destination", 6, 120);
  return calculateAmazonDriverRoute(origin, destination, input.avoidFerries === true);
}
