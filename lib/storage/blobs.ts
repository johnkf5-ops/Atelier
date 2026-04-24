import { put, del, head } from '@vercel/blob';

export type BlobUploadResult = { url: string; pathname: string };

export async function putBlob(
  key: string,
  body: Buffer | Blob,
  contentType: string,
): Promise<BlobUploadResult> {
  const result = await put(key, body, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return { url: result.url, pathname: result.pathname };
}

export async function deleteBlob(pathname: string): Promise<void> {
  await del(pathname);
}

export async function blobInfo(pathname: string) {
  return head(pathname);
}
