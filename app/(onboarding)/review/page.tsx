import ReviewClient from './review-client';

export const dynamic = 'force-dynamic';

export default function ReviewPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-3xl">Review</h1>
        <p className="text-neutral-400 text-sm mt-1">
          Edit any field. Manual edits are pinned and cannot be overwritten by future ingestion.
        </p>
      </div>
      <ReviewClient />
    </div>
  );
}
