import sharp from "sharp";

const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 80;

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);

export type CompressResult = {
  buffer: Buffer;
  contentType: string;
};

/**
 * Compresses image uploads server-side (resize longest side to ~1920px,
 * re-encode as JPEG quality ~80) so results stay consistent regardless of
 * the uploader's device/browser. PDFs pass through untouched.
 */
export async function compressImageIfNeeded(
  buffer: Buffer,
  mimeType: string
): Promise<CompressResult> {
  if (!IMAGE_MIME_TYPES.has(mimeType)) {
    return { buffer, contentType: mimeType };
  }

  const compressed = await sharp(buffer)
    .rotate() // apply EXIF orientation before resizing
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  return { buffer: compressed, contentType: "image/jpeg" };
}
