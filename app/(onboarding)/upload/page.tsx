import UploadClient from './upload-client';

export const dynamic = 'force-dynamic';

export default function UploadPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-3xl">Upload portfolio</h1>
        <p className="text-neutral-400 text-sm mt-1">
          Drop 20–100 images. EXIF camera/lens data is preserved; GPS is stripped.
        </p>
      </div>
      <UploadClient />
    </div>
  );
}
