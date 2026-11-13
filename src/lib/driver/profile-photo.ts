import sharp from "sharp";
import { db } from "@/lib/db";
import { DriverError } from "@/lib/driver/errors";

export const maxProfilePhotoBytes = 192 * 1024;

export async function encodeDriverProfilePhoto(source: Buffer) {
  if (source.length < 4 || source[0] !== 0xff || source[1] !== 0xd8 || source[2] !== 0xff) {
    throw new DriverError(415, "INVALID_PROFILE_PHOTO", "Choose a readable photo.");
  }

  let jpeg: Buffer;
  try {
    jpeg = await sharp(source, { limitInputPixels: 4_000_000, failOn: "warning" })
      .rotate()
      .resize(384, 384, { fit: "cover", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    throw new DriverError(415, "INVALID_PROFILE_PHOTO", "Choose a readable photo.");
  }
  return jpeg;
}

export async function driverProfilePhoto(driverId: string) {
  const photo = await db.driverProfilePhoto.findUnique({ where: { driverId } });
  return { photo: photo ? Buffer.from(photo.jpeg).toString("base64") : null };
}

export async function saveDriverProfilePhoto(driverId: string, source: Buffer) {
  const jpeg = await encodeDriverProfilePhoto(source);
  await db.driverProfilePhoto.upsert({
    where: { driverId },
    create: { driverId, jpeg: Uint8Array.from(jpeg) },
    update: { jpeg: Uint8Array.from(jpeg) },
  });
  return { photo: jpeg.toString("base64") };
}

export async function removeDriverProfilePhoto(driverId: string) {
  await db.driverProfilePhoto.deleteMany({ where: { driverId } });
  return { photo: null };
}
