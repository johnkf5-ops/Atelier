'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type Akb = Record<string, unknown> & {
  identity: {
    legal_name: string;
    public_name: string;
    pronouns: string;
    citizenship: string[];
    home_base: { city: string; state: string; country: string };
    year_of_birth: number | null;
  };
  practice: {
    primary_medium: string;
    secondary_media: string[];
    process_description: string;
    materials_and_methods: string[];
    typical_scale: string;
  };
  career_stage: 'emerging' | 'mid-career' | 'established' | 'late-career';
  intent: { statement: string; influences: string[]; aspirations: string[] };
  source_provenance: Record<string, string>;
};

// The server may return AKB rows with `undefined` or missing optional leaves
// (e.g. empty-Akb omits home_base.state entirely). Normalize to concrete
// empty strings/nulls before first render so inputs are ALWAYS controlled
// — no "changing an uncontrolled input to be controlled" React warning.
function normalizeAkbForForm(raw: Record<string, unknown>): Akb {
  const r = raw as Record<string, unknown>;
  const identity = (r.identity ?? {}) as Record<string, unknown>;
  const home_base = (identity.home_base ?? {}) as Record<string, unknown>;
  const practice = (r.practice ?? {}) as Record<string, unknown>;
  const intent = (r.intent ?? {}) as Record<string, unknown>;
  return {
    ...r,
    identity: {
      legal_name: (identity.legal_name as string) ?? '',
      public_name: (identity.public_name as string) ?? '',
      pronouns: (identity.pronouns as string) ?? '',
      citizenship: (identity.citizenship as string[]) ?? [],
      home_base: {
        city: (home_base.city as string) ?? '',
        state: (home_base.state as string) ?? '',
        country: (home_base.country as string) ?? '',
      },
      year_of_birth: (identity.year_of_birth as number | null) ?? null,
    },
    practice: {
      primary_medium: (practice.primary_medium as string) ?? '',
      secondary_media: (practice.secondary_media as string[]) ?? [],
      process_description: (practice.process_description as string) ?? '',
      materials_and_methods: (practice.materials_and_methods as string[]) ?? [],
      typical_scale: (practice.typical_scale as string) ?? '',
    },
    career_stage:
      ((r.career_stage as Akb['career_stage']) ?? 'emerging'),
    intent: {
      statement: (intent.statement as string) ?? '',
      influences: (intent.influences as string[]) ?? [],
      aspirations: (intent.aspirations as string[]) ?? [],
    },
    source_provenance: (r.source_provenance as Record<string, string>) ?? {},
  };
}

type StyleFp = Record<string, unknown> | null;

export default function ReviewClient() {
  const [akb, setAkb] = useState<Akb | null>(null);
  const [fp, setFp] = useState<StyleFp>(null);
  const [draft, setDraft] = useState<Akb | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [validation, setValidation] = useState<{ valid: boolean; issues: { path: string; message: string }[] } | null>(null);

  const refreshValidation = async () => {
    const v = await fetch('/api/akb/validate', { cache: 'no-store' }).then((r) => r.json());
    setValidation({ valid: !!v.valid, issues: v.issues ?? [] });
  };

  useEffect(() => {
    (async () => {
      const [a, f] = await Promise.all([
        fetch('/api/akb/current').then((r) => r.json()),
        fetch('/api/style-analyst/run').then((r) => r.json()),
      ]);
      const normalized = a.akb ? normalizeAkbForForm(a.akb as Record<string, unknown>) : null;
      setAkb(normalized);
      setDraft(normalized);
      setFp(f.fingerprint ?? null);
      refreshValidation();
    })();
  }, []);

  const dirtyPatch = useMemo(() => {
    if (!akb || !draft) return null;
    return computePatch(akb, draft);
  }, [akb, draft]);

  const dirty = dirtyPatch !== null && Object.keys(dirtyPatch).length > 0;

  async function save() {
    if (!dirty || !dirtyPatch) return;
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch('/api/akb/manual-edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch: dirtyPatch }),
      });
      const j = await res.json();
      if (j.error) {
        setStatus(`error: ${j.error}`);
      } else {
        const normalized = normalizeAkbForForm(j.akb as Record<string, unknown>);
        setAkb(normalized);
        setDraft(normalized);
        setStatus(`saved · changed: ${j.changed?.join(', ') || 'nothing'}`);
        refreshValidation();
      }
    } finally {
      setSaving(false);
    }
  }

  if (!draft) return <div className="text-neutral-500">loading…</div>;

  const ready = validation?.valid === true;
  const issuesByPath = new Map<string, string>();
  (validation?.issues ?? []).forEach((i) => {
    if (!issuesByPath.has(i.path)) issuesByPath.set(i.path, i.message);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="rounded border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-40"
        >
          {saving ? 'Saving…' : dirty ? 'Save manual edits' : 'No changes'}
        </button>
        <Link
          href="/runs/new"
          aria-disabled={!ready}
          className={`rounded border border-neutral-700 px-4 py-2 text-sm ${
            ready ? 'hover:bg-neutral-800' : 'opacity-40 pointer-events-none'
          }`}
          title={ready ? 'Start your first run' : `${validation?.issues.length ?? 0} field(s) still missing`}
        >
          Start your first run →
        </Link>
        {status && <span className="text-xs text-neutral-400">{status}</span>}
      </div>

      {validation && !validation.valid && validation.issues.length > 0 && (
        <div className="rounded border border-amber-800 bg-amber-950/30 p-3 text-sm space-y-1">
          <div className="text-amber-300 font-medium">
            Knowledge Base is incomplete — {validation.issues.length} field(s) missing or invalid:
          </div>
          <ul className="text-xs text-amber-200/80 font-mono space-y-0.5 max-h-40 overflow-auto">
            {validation.issues.map((i, idx) => (
              <li key={idx}>
                {i.path || '(root)'}: {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Identity" provenancePrefix="identity" akb={draft}>
          <Field label="Legal name" path="identity.legal_name" akb={draft}
            value={draft.identity.legal_name}
            onChange={(v) => setDraft({ ...draft, identity: { ...draft.identity, legal_name: v } })} />
          <Field label="Public name" path="identity.public_name" akb={draft}
            value={draft.identity.public_name}
            onChange={(v) => setDraft({ ...draft, identity: { ...draft.identity, public_name: v } })} />
          <Field label="Pronouns" path="identity.pronouns" akb={draft}
            value={draft.identity.pronouns}
            onChange={(v) => setDraft({ ...draft, identity: { ...draft.identity, pronouns: v } })} />
          <ArrayField label="Citizenship" path="identity.citizenship" akb={draft}
            value={draft.identity.citizenship}
            onChange={(v) => setDraft({ ...draft, identity: { ...draft.identity, citizenship: v } })} />
          <Field label="Home base — city" path="identity.home_base" akb={draft}
            value={draft.identity.home_base.city}
            onChange={(v) => setDraft({ ...draft, identity: { ...draft.identity, home_base: { ...draft.identity.home_base, city: v } } })} />
          <Field label="State" path="identity.home_base" akb={draft}
            value={draft.identity.home_base.state}
            onChange={(v) => setDraft({ ...draft, identity: { ...draft.identity, home_base: { ...draft.identity.home_base, state: v } } })} />
          <Field label="Country" path="identity.home_base" akb={draft}
            value={draft.identity.home_base.country}
            onChange={(v) => setDraft({ ...draft, identity: { ...draft.identity, home_base: { ...draft.identity.home_base, country: v } } })} />
          <Field label="Year of birth" path="identity.year_of_birth" akb={draft}
            value={draft.identity.year_of_birth == null ? '' : String(draft.identity.year_of_birth)}
            onChange={(v) => {
              const n = v === '' ? null : Number(v);
              setDraft({ ...draft, identity: { ...draft.identity, year_of_birth: Number.isFinite(n as number) ? (n as number) : null } });
            }} />
        </Section>

        <Section title="Practice" provenancePrefix="practice" akb={draft}>
          <Field label="Primary medium" path="practice.primary_medium" akb={draft}
            value={draft.practice.primary_medium}
            onChange={(v) => setDraft({ ...draft, practice: { ...draft.practice, primary_medium: v } })} />
          <ArrayField label="Secondary media" path="practice.secondary_media" akb={draft}
            value={draft.practice.secondary_media}
            onChange={(v) => setDraft({ ...draft, practice: { ...draft.practice, secondary_media: v } })} />
          <TextArea label="Process description" path="practice.process_description" akb={draft}
            value={draft.practice.process_description}
            onChange={(v) => setDraft({ ...draft, practice: { ...draft.practice, process_description: v } })} />
          <ArrayField label="Materials & methods" path="practice.materials_and_methods" akb={draft}
            value={draft.practice.materials_and_methods}
            onChange={(v) => setDraft({ ...draft, practice: { ...draft.practice, materials_and_methods: v } })} />
          <Field label="Typical scale" path="practice.typical_scale" akb={draft}
            value={draft.practice.typical_scale}
            onChange={(v) => setDraft({ ...draft, practice: { ...draft.practice, typical_scale: v } })} />
          <SelectField label="Career stage" path="career_stage" akb={draft}
            value={draft.career_stage}
            options={['emerging', 'mid-career', 'established', 'late-career']}
            onChange={(v) => setDraft({ ...draft, career_stage: v as Akb['career_stage'] })} />
        </Section>

        <Section title="Intent" provenancePrefix="intent" akb={draft}>
          <TextArea label="Statement (what the work is about)" path="intent.statement" akb={draft}
            value={draft.intent.statement}
            onChange={(v) => setDraft({ ...draft, intent: { ...draft.intent, statement: v } })} />
          <ArrayField label="Influences" path="intent.influences" akb={draft}
            value={draft.intent.influences}
            onChange={(v) => setDraft({ ...draft, intent: { ...draft.intent, influences: v } })} />
          <ArrayField label="Aspirations" path="intent.aspirations" akb={draft}
            value={draft.intent.aspirations}
            onChange={(v) => setDraft({ ...draft, intent: { ...draft.intent, aspirations: v } })} />
        </Section>

        <Section title="Style Fingerprint (read-only)" provenancePrefix="" akb={draft}>
          <pre className="text-[11px] text-neutral-300 overflow-auto max-h-[36rem] leading-snug whitespace-pre-wrap">
{fp ? JSON.stringify(fp, null, 2) : 'No fingerprint yet — run Style Analyst from /upload'}
          </pre>
        </Section>
      </div>

      <Section title="Bodies of work / exhibitions / publications / awards / collections / representation" provenancePrefix="" akb={draft}>
        <pre className="text-[11px] text-neutral-300 overflow-auto max-h-[24rem] leading-snug whitespace-pre-wrap">
{JSON.stringify({
  bodies_of_work: draft.bodies_of_work,
  exhibitions: draft.exhibitions,
  publications: draft.publications,
  awards_and_honors: draft.awards_and_honors,
  collections: draft.collections,
  representation: draft.representation,
  education: draft.education,
}, null, 2)}
        </pre>
        <p className="text-xs text-neutral-500 mt-2">
          Array editing UI lands in Path B; for v1 these are populated by ingestion + interview.
          Edit raw JSON via the API if needed.
        </p>
      </Section>
    </div>
  );
}

function provenanceFor(akb: Akb, path: string): string {
  return akb.source_provenance[path] ?? '—';
}

function Section({
  title,
  children,
  provenancePrefix,
  akb,
}: {
  title: string;
  children: React.ReactNode;
  provenancePrefix: string;
  akb: Akb;
}) {
  void provenancePrefix; void akb;
  return (
    <section className="rounded border border-neutral-800 p-4 space-y-3">
      <h2 className="text-sm uppercase tracking-wide text-neutral-500">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, value, onChange, path, akb }: { label: string; value: string; onChange: (v: string) => void; path: string; akb: Akb }) {
  return (
    <label className="block">
      <div className="flex justify-between items-baseline">
        <span className="text-xs text-neutral-400">{label}</span>
        <span className="text-[10px] text-neutral-600 font-mono">{provenanceFor(akb, path)}</span>
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm mt-1"
      />
    </label>
  );
}

function TextArea({ label, value, onChange, path, akb }: { label: string; value: string; onChange: (v: string) => void; path: string; akb: Akb }) {
  return (
    <label className="block">
      <div className="flex justify-between items-baseline">
        <span className="text-xs text-neutral-400">{label}</span>
        <span className="text-[10px] text-neutral-600 font-mono">{provenanceFor(akb, path)}</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm mt-1"
      />
    </label>
  );
}

function ArrayField({ label, value, onChange, path, akb }: { label: string; value: string[]; onChange: (v: string[]) => void; path: string; akb: Akb }) {
  const text = value.join(', ');
  return (
    <label className="block">
      <div className="flex justify-between items-baseline">
        <span className="text-xs text-neutral-400">{label} (comma-separated)</span>
        <span className="text-[10px] text-neutral-600 font-mono">{provenanceFor(akb, path)}</span>
      </div>
      <input
        value={text}
        onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
        className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm mt-1"
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options, path, akb }: { label: string; value: string; onChange: (v: string) => void; options: string[]; path: string; akb: Akb }) {
  return (
    <label className="block">
      <div className="flex justify-between items-baseline">
        <span className="text-xs text-neutral-400">{label}</span>
        <span className="text-[10px] text-neutral-600 font-mono">{provenanceFor(akb, path)}</span>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm mt-1"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

// Compute a partial AKB containing only the scalar/object/array fields the user changed
// in the form. Conservative: only walks the form-editable fields.
function computePatch(orig: Akb, next: Akb): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const idChanged: Record<string, unknown> = {};
  if (next.identity.legal_name !== orig.identity.legal_name) idChanged.legal_name = next.identity.legal_name;
  if ((next.identity.public_name ?? '') !== (orig.identity.public_name ?? '')) idChanged.public_name = next.identity.public_name;
  if ((next.identity.pronouns ?? '') !== (orig.identity.pronouns ?? '')) idChanged.pronouns = next.identity.pronouns;
  if (JSON.stringify(next.identity.citizenship) !== JSON.stringify(orig.identity.citizenship)) idChanged.citizenship = next.identity.citizenship;
  if (JSON.stringify(next.identity.home_base) !== JSON.stringify(orig.identity.home_base)) idChanged.home_base = next.identity.home_base;
  if (next.identity.year_of_birth !== orig.identity.year_of_birth) idChanged.year_of_birth = next.identity.year_of_birth;
  if (Object.keys(idChanged).length > 0) patch.identity = idChanged;

  const prChanged: Record<string, unknown> = {};
  if (next.practice.primary_medium !== orig.practice.primary_medium) prChanged.primary_medium = next.practice.primary_medium;
  if (JSON.stringify(next.practice.secondary_media) !== JSON.stringify(orig.practice.secondary_media)) prChanged.secondary_media = next.practice.secondary_media;
  if (next.practice.process_description !== orig.practice.process_description) prChanged.process_description = next.practice.process_description;
  if (JSON.stringify(next.practice.materials_and_methods) !== JSON.stringify(orig.practice.materials_and_methods)) prChanged.materials_and_methods = next.practice.materials_and_methods;
  if ((next.practice.typical_scale ?? '') !== (orig.practice.typical_scale ?? '')) prChanged.typical_scale = next.practice.typical_scale;
  if (Object.keys(prChanged).length > 0) patch.practice = prChanged;

  const inChanged: Record<string, unknown> = {};
  if (next.intent.statement !== orig.intent.statement) inChanged.statement = next.intent.statement;
  if (JSON.stringify(next.intent.influences) !== JSON.stringify(orig.intent.influences)) inChanged.influences = next.intent.influences;
  if (JSON.stringify(next.intent.aspirations) !== JSON.stringify(orig.intent.aspirations)) inChanged.aspirations = next.intent.aspirations;
  if (Object.keys(inChanged).length > 0) patch.intent = inChanged;

  if (next.career_stage !== orig.career_stage) patch.career_stage = next.career_stage;

  return patch;
}
