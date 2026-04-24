import InterviewClient from './interview-client';

export const dynamic = 'force-dynamic';

export default function InterviewPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-3xl">Knowledge Extractor</h1>
        <p className="text-neutral-400 text-sm mt-1">
          Optionally seed with URLs (your site, gallery bios, press) — Claude ingests what is
          public, then asks targeted questions to fill the gaps.
        </p>
      </div>
      <InterviewClient />
    </div>
  );
}
