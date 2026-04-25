import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * WALKTHROUGH Note 28 (CRITICAL — vision unlock): the Files API helper
 * MUST normalize incoming bytes through Sharp before uploading. Raw bytes
 * served from Vercel Blob carry color profiles / progressive encoding /
 * embedded metadata that Anthropic's multimodal vision pipeline cannot
 * decode (read tool returns "Output could not be decoded as text").
 *
 * Diagnosed via probe scripts (probe-portfolio.mjs, probe-real-file.mjs):
 *   - PORTFOLIO files (raw from Vercel Blob, no Sharp) → vision FAILS
 *   - RECIPIENT files (Sharp-normalized via finalize-scout) → vision SUCCEEDS
 *
 * This suite locks in the normalization contract structurally:
 *   - normalizeForVision converts arbitrary input to baseline JPEG
 *   - uploadVisionReadyImage routes through normalize then files.upload
 *   - on Sharp failure (rare formats), falls back to raw bytes + flags it
 *   - the file uploaded to Anthropic is the NORMALIZED buffer, not raw
 *
 * Plus a live integration test (gated on ATELIER_LIVE_FILES_API=true) that
 * uploads a fixture, mounts in a session, asks the agent to read it, and
 * asserts the response is multimodal vision content — not "VISION FAILED"
 * or "Output could not be decoded as text".
 */

// vi.hoisted is REQUIRED here: vi.mock factories run before module-scope
// `const` declarations, so a plain `const filesUpload = vi.fn()` is
// undefined when the factory is invoked. vi.hoisted lifts the declaration
// to the same hoisted phase as vi.mock.
const { filesUpload } = vi.hoisted(() => ({ filesUpload: vi.fn() }));

vi.mock('@/lib/anthropic', () => ({
  getAnthropic: () => ({ beta: { files: { upload: filesUpload } } }),
  MODEL_OPUS: 'claude-opus-4-7-mock',
}));

beforeEach(() => {
  filesUpload.mockReset();
  filesUpload.mockResolvedValue({ id: 'file_mock123' });
});

// 1x1 PNG (8-byte header + IHDR + IDAT + IEND). Sharp can decode + re-encode
// this as JPEG so normalize succeeds.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2P4DwQACfsD/Z7M0psAAAAASUVORK5CYII=',
  'base64',
);

describe('normalizeForVision', () => {
  it('returns baseline JPEG bytes for a valid input image', async () => {
    const { normalizeForVision } = await import('@/lib/anthropic-files');
    const out = await normalizeForVision(TINY_PNG);
    expect(out.usedFallback).toBe(false);
    expect(out.contentType).toBe('image/jpeg');
    expect(out.extension).toBe('jpg');
    // Baseline JPEG starts with the SOI marker FF D8 FF.
    expect(out.buf[0]).toBe(0xff);
    expect(out.buf[1]).toBe(0xd8);
    expect(out.buf[2]).toBe(0xff);
  });

  it('falls back to raw bytes when sharp cannot decode the input', async () => {
    const { normalizeForVision } = await import('@/lib/anthropic-files');
    // Garbage bytes — not a real image. Sharp throws.
    const garbage = Buffer.from('this is plain text, not an image at all');
    const out = await normalizeForVision(garbage, 'image/webp');
    expect(out.usedFallback).toBe(true);
    expect(out.buf).toEqual(garbage);
    // Falls back to provided contentType when valid, else image/jpeg.
    expect(out.contentType).toBe('image/webp');
    expect(out.extension).toBe('webp');
  });

  it('falls back to image/jpeg when given a non-image fallback contentType', async () => {
    const { normalizeForVision } = await import('@/lib/anthropic-files');
    const garbage = Buffer.from('still not an image');
    const out = await normalizeForVision(garbage, 'application/pdf');
    expect(out.usedFallback).toBe(true);
    expect(out.contentType).toBe('image/jpeg');
    expect(out.extension).toBe('jpg');
  });
});

describe('uploadVisionReadyImage — Note 28 contract', () => {
  it('uploads NORMALIZED bytes to the Files API, not the raw input', async () => {
    const { uploadVisionReadyImage } = await import('@/lib/anthropic-files');
    const fileId = await uploadVisionReadyImage(TINY_PNG, 'test.jpg');
    expect(fileId).toBe('file_mock123');
    expect(filesUpload).toHaveBeenCalledTimes(1);

    const call = filesUpload.mock.calls[0]?.[0] as { file: File } | undefined;
    expect(call?.file).toBeDefined();
    // The uploaded file's content-type must be image/jpeg (the normalize
    // output), not image/png (the raw input). Anthropic's vision pipeline
    // requires baseline JPEG.
    expect(call?.file.type).toBe('image/jpeg');
    // The uploaded bytes must NOT be the raw PNG — they must be the
    // re-encoded JPEG. Compare buffer.length: PNG is 70 bytes, JPEG of a
    // 1x1 white pixel is ~600+ bytes (JPEG headers + Huffman tables).
    const uploadedBuf = await call!.file.arrayBuffer();
    const uploadedBytes = new Uint8Array(uploadedBuf);
    expect(uploadedBytes[0]).toBe(0xff); // JPEG SOI marker
    expect(uploadedBytes[1]).toBe(0xd8);
    expect(uploadedBytes[2]).toBe(0xff);
    // Definitely not the input PNG bytes.
    expect(uploadedBytes.byteLength).not.toBe(TINY_PNG.length);
  });

  it('still uploads (raw bytes) when sharp cannot decode the input', async () => {
    const { uploadVisionReadyImage } = await import('@/lib/anthropic-files');
    const garbage = Buffer.from('not an image but upload anyway');
    const fileId = await uploadVisionReadyImage(garbage, 'fallback.bin');
    expect(fileId).toBe('file_mock123');
    expect(filesUpload).toHaveBeenCalledTimes(1);
    const call = filesUpload.mock.calls[0]?.[0] as { file: File } | undefined;
    // Fallback path uploads the raw bytes with image/jpeg as the best-effort
    // content-type. Vision may fail; that's the whole point of the warning.
    expect(call?.file.type).toBe('image/jpeg');
    const uploadedBuf = await call!.file.arrayBuffer();
    expect(new Uint8Array(uploadedBuf).byteLength).toBe(garbage.length);
  });
});

// Live integration coverage lives in scripts/probe-vision.mjs +
// scripts/probe-real-file.mjs (retained as live regression diagnostics).
// Inlining a vi.unmock-based live test in this file would get hoisted out
// of the gated describe block and disable the structural mock for ALL
// tests — confirmed by the Note 28 first-pass debug. If we need a CI live
// test in the future, it must live in its own file with no vi.mock.
