import sharp from 'sharp';
import exifr from 'exifr';
import { createHash } from 'node:crypto';

export type Preprocessed = {
  hash: string;            // SHA-256 of original bytes — stable, idempotent key
  original: Buffer;        // rotated, EXIF-stripped, JPEG q92
  thumb: Buffer;           // 1024px max side, JPEG q85
  width: number;
  height: number;
  exif: Record<string, unknown> | null;
};

const KEEP_EXIF_FIELDS = [
  'Make', 'Model', 'LensModel', 'LensMake',
  'FocalLength', 'FocalLengthIn35mmFormat',
  'FNumber', 'ApertureValue',
  'ISO', 'ISOSpeedRatings',
  'ExposureTime', 'ShutterSpeedValue',
  'DateTimeOriginal', 'CreateDate',
];

export async function preprocessImage(input: Buffer): Promise<Preprocessed> {
  const hash = createHash('sha256').update(input).digest('hex');

  // EXIF extraction — TIFF + EXIF blocks; explicitly drop GPS for privacy.
  const rawExif = (await exifr.parse(input, { tiff: true, exif: true, gps: false })) as
    | Record<string, unknown>
    | undefined;
  const exif = rawExif
    ? Object.fromEntries(
        KEEP_EXIF_FIELDS.filter((k) => rawExif[k] !== undefined).map((k) => [k, rawExif[k]]),
      )
    : null;

  const original = await sharp(input)
    .rotate()
    .withMetadata({})
    .jpeg({ quality: 92 })
    .toBuffer();

  const thumbPipeline = sharp(input)
    .rotate()
    .resize(1024, 1024, { fit: 'inside' })
    .jpeg({ quality: 85 });
  const { data: thumb, info } = await thumbPipeline.toBuffer({ resolveWithObject: true });

  return {
    hash,
    original,
    thumb,
    width: info.width,
    height: info.height,
    exif: exif && Object.keys(exif).length > 0 ? exif : null,
  };
}
