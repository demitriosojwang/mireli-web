import { describe, expect, it } from "vitest";
import { isPublishedStagePin } from "@/lib/stage-pin";

describe("passenger stage map", () => {
  it.each([
    { id: "cmwiyyu6f000llicy0i9txsow", lat: -4.05529, lng: 39.68247 },
    { id: "cmwiyyu6m000tlicy1kmkc2xi", lat: -4.03809, lng: 39.68118 },
  ])("withholds the unrevised position for $id", stage => {
    expect(isPublishedStagePin(stage)).toBe(false);
    expect(isPublishedStagePin({ ...stage, lat: stage.lat + 0.01 })).toBe(true);
    expect(isPublishedStagePin({ ...stage, id: "another-stop" })).toBe(true);
  });
});
