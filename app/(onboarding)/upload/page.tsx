import UploadClient from './upload-client';
import { PageHeader } from '@/app/_components/ui';

export const dynamic = 'force-dynamic';

export default function UploadPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Step 1"
        title="Your portfolio"
        subtitle="Drop 20–100 images, or paste URLs and we'll scrape them. EXIF camera and lens data is preserved; GPS is stripped."
      />
      <UploadClient />
    </div>
  );
}
