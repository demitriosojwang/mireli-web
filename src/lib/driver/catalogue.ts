export const POLICY_VERSION = "mireli-checklist-2026-10-04";
export const requirements = [
  {id: "identity", title: "National ID or passport", expires: false, required: true},
  {id: "licence", title: "Driving licence", expires: true, required: true},
  {id: "psv_badge", title: "PSV driver badge", expires: true, required: true},
  {id: "good_conduct", title: "Certificate of good conduct", expires: false, required: true},
  {id: "insurance", title: "PSV insurance", expires: true, required: true},
  {id: "inspection", title: "Vehicle inspection certificate", expires: true, required: true},
  {id: "logbook", title: "Logbook / e-logbook", expires: false, required: true},
];
export const maxDocumentBytes = () => process.env.VERCEL ? 2 * 1024 * 1024 : 10 * 1024 * 1024;
export function validFile(mime: string, bytes: Uint8Array) {
  if (mime === "application/pdf") return Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-";
  if (mime === "image/jpeg") return bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/png") return Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  return false;
}
