import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { compressImageIfNeeded } from "./image-compress";

async function makeTestPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 100, g: 120, b: 140 },
    },
  })
    .png()
    .toBuffer();
}

describe("compressImageIfNeeded", () => {
  it("resizes an oversized image down to max ~1920px on the longest side", async () => {
    const original = await makeTestPng(3000, 2000);

    const result = await compressImageIfNeeded(original, "image/png");

    const meta = await sharp(result.buffer).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1920);
  });

  it("re-encodes as JPEG and reports image/jpeg content type", async () => {
    const original = await makeTestPng(2400, 1600);

    const result = await compressImageIfNeeded(original, "image/png");

    expect(result.contentType).toBe("image/jpeg");
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe("jpeg");
  });

  it("produces a smaller output than the original for a high-resolution photo-like image", async () => {
    const original = await makeTestPng(4000, 3000);

    const result = await compressImageIfNeeded(original, "image/png");

    expect(result.buffer.length).toBeLessThan(original.length);
  });

  it("leaves PDFs untouched", async () => {
    const pdfBuffer = Buffer.from("%PDF-1.4 fake pdf content");

    const result = await compressImageIfNeeded(pdfBuffer, "application/pdf");

    expect(result.buffer).toBe(pdfBuffer);
    expect(result.contentType).toBe("application/pdf");
  });

  it("does not upscale images already smaller than the max dimension", async () => {
    const original = await makeTestPng(800, 600);

    const result = await compressImageIfNeeded(original, "image/png");

    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });
});
