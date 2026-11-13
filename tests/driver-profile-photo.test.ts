import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { encodeDriverProfilePhoto } from "@/lib/driver/profile-photo";
import { GET, PUT, DELETE } from "@/app/api/v1/driver/[...path]/route";

describe("driver profile photo", () => {
  it("keeps only a bounded image with metadata stripped", async () => {
    const source = await sharp({
      create: { width: 640, height: 480, channels: 3, background: "#0b826e" },
    }).jpeg().withMetadata().toBuffer();

    const result = await encodeDriverProfilePhoto(source);
    const photo = await sharp(result).metadata();
    expect(photo).toMatchObject({ width: 384, height: 384, format: "jpeg" });
    expect(photo.exif).toBeUndefined();
    expect(photo.icc).toBeUndefined();
  });

  it("rejects an invalid payload even with a JPEG signature", async () => {
    await expect(encodeDriverProfilePhoto(Buffer.from([255, 216, 255, 12, 15, 91])))
      .rejects.toMatchObject({ code: "INVALID_PROFILE_PHOTO" });
  });

  it.each([["GET", GET], ["PUT", PUT], ["DELETE", DELETE]])("requires a driver session for %s", async (method, handler) => {
    const response = await handler(new Request("https://mireli.online/api/v1/driver/profile-photo", { method }),
      { params: Promise.resolve({ path: ["profile-photo"] }) });
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
