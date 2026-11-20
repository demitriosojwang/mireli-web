/** The old Fisheries pin falls in the harbour. VOK shares the old Lights pin.
 * Let a corrected position appear as soon as staff save it for either stage.
 */
export function isPublishedStagePin(stage: { id: string; lat: number; lng: number }) {
  return !(stage.id === "cmwiyyu6f000llicy0i9txsow" && stage.lat === -4.05529 && stage.lng === 39.68247)
    && !(stage.id === "cmwiyyu6m000tlicy1kmkc2xi" && stage.lat === -4.03809 && stage.lng === 39.68118);
}
