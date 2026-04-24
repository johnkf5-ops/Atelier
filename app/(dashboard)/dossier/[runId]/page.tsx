export default async function DossierPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <div className="space-y-4">
      <h1 className="font-serif text-3xl">Dossier — Run {runId}</h1>
      <p className="text-neutral-400 text-sm">Career Dossier view + PDF download lands here in Phase 4.</p>
    </div>
  );
}
