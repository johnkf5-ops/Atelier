import { LinkButton } from '@/app/_components/ui';

export default function HomePage() {
  return (
    <div className="max-w-3xl mx-auto py-16 space-y-12">
      <div className="space-y-6">
        <div className="text-[11px] uppercase tracking-widest text-neutral-500">
          AI art director · for working visual artists
        </div>
        <h1 className="font-serif text-6xl leading-[1.05] tracking-tight text-neutral-100">
          Apply to the rooms where your work actually belongs.
        </h1>
        <p className="font-serif text-xl text-neutral-300 leading-[1.55] max-w-2xl">
          Upload your portfolio. Atelier reads what your work actually is, finds the grants
          and residencies that fit, and drafts the application materials —
          a complete career dossier in under an hour.
        </p>
        <div className="flex gap-3 pt-2">
          <LinkButton href="/upload" variant="primary" size="md">
            Start onboarding →
          </LinkButton>
          <LinkButton href="/runs" variant="ghost" size="md">
            View past runs
          </LinkButton>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-8 border-t border-neutral-800">
        <Step
          n="1"
          title="Read"
          body="Vision-analyse your portfolio and surface its real aesthetic lineage — not what you wish, what it is."
        />
        <Step
          n="2"
          title="Match"
          body="Search current open calls and score each against your work + recipient cohorts. Honest reads, no flattery."
        />
        <Step
          n="3"
          title="Draft"
          body="Statement, proposal, CV, cover letter for every opportunity that fits. Edit, copy, submit."
        />
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-widest text-neutral-600 font-mono">{n}</div>
      <h3 className="font-serif text-2xl text-neutral-100">{title}</h3>
      <p className="text-sm text-neutral-400 leading-relaxed">{body}</p>
    </div>
  );
}
