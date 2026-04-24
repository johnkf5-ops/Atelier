export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="space-y-4">
      <h1 className="font-serif text-3xl">Run {id}</h1>
      <p className="text-neutral-400 text-sm">Live activity feed lands here in Phase 4.5.</p>
    </div>
  );
}
