import {afterEach,describe,expect,it,vi} from "vitest";
import type { Route, RouteLeg } from "@aws-sdk/client-geo-routes";
import { normalizeAmazonDriverRoute } from "@/lib/driver/amazon-location";
import {navigationRoutingConfigured,normalizeValhallaRoute} from "@/lib/driver/navigation";

afterEach(()=>vi.unstubAllEnvs());

describe("open-source driver route service",()=>{
  it("accepts only a configured HTTPS Valhalla endpoint",()=>{
    expect(navigationRoutingConfigured()).toBe(false);
    vi.stubEnv("VALHALLA_URL","http://127.0.0.1:8002/route");expect(navigationRoutingConfigured()).toBe(false);
    vi.stubEnv("VALHALLA_URL","https://localhost/route");expect(navigationRoutingConfigured()).toBe(false);
    vi.stubEnv("VALHALLA_URL","https://routes.example/route?url=https://evil.example");expect(navigationRoutingConfigured()).toBe(false);
    vi.stubEnv("VALHALLA_URL","https://routing.mireli.co.ke/route");expect(navigationRoutingConfigured()).toBe(false);
    vi.stubEnv("VALHALLA_API_TOKEN","t".repeat(40));expect(navigationRoutingConfigured()).toBe(true);
  });
  it("normalizes route shape and instructions while stripping control characters",()=>{
    const result=normalizeValhallaRoute({trip:{legs:[{shape:"encoded-polyline",summary:{length:12.34,time:900},maneuvers:[
      {instruction:"Turn left\n<script>unsupported</script>",length:0.4,time:30,begin_shape_index:0,end_shape_index:12},
    ]}]}});
    expect(result).toEqual({provider:"valhalla",geometry:"encoded-polyline",distanceMeters:12340,durationSeconds:900,
      maneuvers:[{instruction:"Turn left <script>unsupported</script>",distanceMeters:400,durationSeconds:30,beginShapeIndex:0,endShapeIndex:12}]});
  });
  it("rejects malformed, empty, oversized, and impossible routes",()=>{
    expect(()=>normalizeValhallaRoute(null)).toThrow();
    expect(()=>normalizeValhallaRoute({trip:{legs:[]}})).toThrow();
    expect(()=>normalizeValhallaRoute({trip:{legs:[{shape:"x",summary:{length:600,time:900},maneuvers:[]}]}})).toThrow();
  });
});

describe("Amazon Location route legs", () => {
  const origin = [39.65, -4.08];
  const pier = [39.66, -4.08];
  const landing = [39.66, -4.07];
  const terminus = [39.57, -4.02];
  function leg(points: number[][], type: "Vehicle" | "Ferry", distance: number, duration: number): RouteLeg {
    const details = { Summary: { Overview: { Distance: distance, Duration: duration } } };
    return {
      Type: type,
      TravelMode: type === "Ferry" ? "Ferry" : "Car",
      Geometry: { LineString: points },
      ...(type === "Ferry" ? { FerryLegDetails: details } : { VehicleLegDetails: details }),
    } as RouteLeg;
  }
  const crossing = { Legs: [
    leg([origin, pier], "Vehicle", 500, 120),
    leg([pier, landing], "Ferry", 800, 1850),
    leg([landing, terminus], "Vehicle", 17000, 1900),
  ] } as Route;
  const bypass = { Legs: [leg([origin, [39.60, -4.10], terminus], "Vehicle", 22000, 1600)] } as Route;

  it("joins every leg and includes ferry time and distance", () => {
    const route = normalizeAmazonDriverRoute([crossing], false);
    expect(route).toMatchObject({
      points: [origin, pier, landing, terminus],
      distanceMeters: 18300,
      durationSeconds: 3870,
      includesFerry: true,
    });
    expect(route.maneuvers[1]).toMatchObject({ instruction: "Take the ferry", beginShapeIndex: 1, endShapeIndex: 2 });
    expect(route.maneuvers.at(-1)?.endShapeIndex).toBe(3);
  });

  it("uses a road-only alternative or explicitly rejects a ferry-only result", () => {
    expect(normalizeAmazonDriverRoute([crossing, bypass], true)).toMatchObject({
      includesFerry: false, distanceMeters: 22000, durationSeconds: 1600,
    });
    expect(() => normalizeAmazonDriverRoute([crossing], true)).toThrow("No ferry-free route found");
  });
});
