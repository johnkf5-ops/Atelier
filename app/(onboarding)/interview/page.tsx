import InterviewClient from './interview-client';
import { PageHeader } from '@/app/_components/ui';

export const dynamic = 'force-dynamic';

export default function InterviewPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Step 2"
        title="Build your Knowledge Base"
        subtitle="Optionally seed with URLs (your site, gallery bios, press) — Atelier ingests what is public, then asks targeted questions to fill the gaps."
      />
      <InterviewClient />
    </div>
  );
}
