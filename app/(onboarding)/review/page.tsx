import ReviewClient from './review-client';
import { PageHeader } from '@/app/_components/ui';

export const dynamic = 'force-dynamic';

export default function ReviewPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Step 3"
        title="Review"
        subtitle="Edit any field. Manual edits are pinned and cannot be overwritten by future imports."
      />
      <ReviewClient />
    </div>
  );
}
