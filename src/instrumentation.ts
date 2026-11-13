export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DRIVER_DOCUMENT_BUCKET || process.env.MIRELI_DEMO_MODE === "true") return;
  const { maintainDriverDocuments } = await import("@/lib/driver/document-maintenance");
  const interval = 60 * 60 * 1000;
  const run = async () => {
    try {
      await maintainDriverDocuments();
    } catch (error) {
      console.error("driver.document.maintenance.failed", { name: error instanceof Error ? error.name : "Unknown" });
    } finally {
      setTimeout(run, interval).unref();
    }
  };
  setTimeout(run, 60_000).unref();
}
