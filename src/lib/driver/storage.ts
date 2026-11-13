import {S3Client, PutObjectCommand, GetObjectCommand, GetPublicAccessBlockCommand, DeleteObjectCommand, ListObjectVersionsCommand} from "@aws-sdk/client-s3";
import {createCipheriv, createDecipheriv, createHash, randomBytes} from "node:crypto";
import {mkdir, writeFile, readFile, unlink} from "node:fs/promises";
import {join} from "node:path";
import {isLocalDemoEnabled} from "@/lib/runtime-mode";
import {DriverError} from "./errors";

const root = () => join(process.cwd(), ".local", "driver-private-documents");
const safeKey = (key: string) => { if (!/^driver-documents\/[a-f0-9]{64}$/.test(key)) throw new DriverError(400,"INVALID_OBJECT","Invalid document."); return key.slice(17); };
const client = () => new S3Client({region: process.env.AWS_REGION});
async function privateBucket(s3: S3Client) {
  const bucket = process.env.DRIVER_DOCUMENT_BUCKET;
  if (!bucket || !process.env.AWS_REGION) throw new DriverError(503,"STORAGE_NOT_CONFIGURED","Private document storage is not configured.");
  const block = (await s3.send(new GetPublicAccessBlockCommand({Bucket: bucket}))).PublicAccessBlockConfiguration;
  if (!block?.BlockPublicAcls || !block.IgnorePublicAcls || !block.BlockPublicPolicy || !block.RestrictPublicBuckets)
    throw new DriverError(503,"STORAGE_NOT_PRIVATE","Document storage privacy checks failed.");
  return bucket;
}
async function localKey() {
  if (!isLocalDemoEnabled()) throw new DriverError(503,"STORAGE_NOT_CONFIGURED","Private document storage is not configured.");
  await mkdir(root(), {recursive: true});
  const path = join(root(), ".key");
  try { await writeFile(path, randomBytes(32), {flag:"wx",mode:0o600}); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const key = await readFile(path); if (key.length !== 32) throw new Error("Invalid local document key"); return key;
}
export async function saveDocument(bytes: Buffer, mime: string): Promise<string> {
  const id = randomBytes(32).toString("hex"); const objectKey = `driver-documents/${id}`;
  if (isLocalDemoEnabled()) {
    const key = await localKey(); const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm",key,iv);
    const encrypted = Buffer.concat([cipher.update(bytes),cipher.final()]);
    await writeFile(join(root(), id),Buffer.concat([iv,cipher.getAuthTag(),encrypted]),{flag:"wx",mode:0o600});
  } else {
    const s3 = client(); const bucket = await privateBucket(s3);
    await s3.send(new PutObjectCommand({Bucket:bucket,Key:objectKey,Body:bytes,ContentType:mime,
      IfNoneMatch:"*",ServerSideEncryption:"AES256",ChecksumSHA256:createHash("sha256").update(bytes).digest("base64")}));
  }
  return objectKey;
}
export async function readDocument(key: string): Promise<Buffer> {
  const id = safeKey(key);
  if (isLocalDemoEnabled()) {
    const bytes = await readFile(join(root(),id));
    const cipher = createDecipheriv("aes-256-gcm",await localKey(),bytes.subarray(0,12)); cipher.setAuthTag(bytes.subarray(12,28));
    return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]);
  }
  const s3 = client(); const bucket = await privateBucket(s3);
  const object = await s3.send(new GetObjectCommand({Bucket:bucket,Key:key}));
  if (!object.Body || (object.ContentLength ?? Infinity) > 10*1024*1024) throw new Error("Invalid document object");
  return Buffer.from(await object.Body.transformToByteArray());
}
export async function purgeDocumentFile(key: string) {
  const id = safeKey(key);
  if (isLocalDemoEnabled()) {
    await unlink(join(root(),id)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    return;
  }
  const s3 = client();
  const Bucket = await privateBucket(s3);
  const objects: { Key: string; VersionId: string }[] = [];
  const markers: typeof objects = [];
  let KeyMarker: string | undefined;
  let VersionIdMarker: string | undefined;
  do {
    const page = await s3.send(new ListObjectVersionsCommand({ Bucket, Prefix: key, KeyMarker, VersionIdMarker }));
    for (const version of page.Versions ?? []) {
      if (version.Key === key && version.VersionId) objects.push({ Key: key, VersionId: version.VersionId });
    }
    for (const marker of page.DeleteMarkers ?? []) {
      if (marker.Key === key && marker.VersionId) markers.push({ Key: key, VersionId: marker.VersionId });
    }
    if (!page.IsTruncated) break;
    if (!page.NextKeyMarker || (KeyMarker === page.NextKeyMarker && VersionIdMarker === page.NextVersionIdMarker)) {
      throw new Error("S3 did not advance document version pagination");
    }
    KeyMarker = page.NextKeyMarker;
    VersionIdMarker = page.NextVersionIdMarker;
  } while (KeyMarker);
  // Remove the bytes before removing markers so retries never expose an older version.
  for (const version of [...objects, ...markers]) {
    await s3.send(new DeleteObjectCommand({ Bucket, ...version }));
  }
}
