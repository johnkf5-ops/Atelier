'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type Image = {
  id: number;
  filename: string;
  thumb_url: string;
  ordinal: number;
};

const MIN_IMAGES = 20;

export default function UploadClient() {
  const [images, setImages] = useState<Image[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analystResult, setAnalystResult] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/portfolio/upload', { cache: 'no-store' });
    const j = await res.json();
    setImages(j.images ?? []);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onDrop = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setBusy(true);
      setErrors([]);
      try {
        const fd = new FormData();
        for (const f of files) fd.append('files', f);
        const res = await fetch('/api/portfolio/upload', { method: 'POST', body: fd });
        const j = await res.json();
        if (j.errors?.length) setErrors(j.errors.map((e: { filename: string; error: string }) => `${e.filename}: ${e.error}`));
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/jpeg': [], 'image/png': [], 'image/webp': [], 'image/heic': [], 'image/heif': [] },
    multiple: true,
    disabled: busy,
  });

  async function onDelete(id: number) {
    await fetch(`/api/portfolio/${id}`, { method: 'DELETE' });
    setImages((cur) => cur.filter((i) => i.id !== id));
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  async function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    setImages((cur) => {
      const oldIdx = cur.findIndex((i) => i.id === Number(e.active.id));
      const newIdx = cur.findIndex((i) => i.id === Number(e.over!.id));
      const reordered = arrayMove(cur, oldIdx, newIdx);
      fetch('/api/portfolio/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order: reordered.map((i) => i.id) }),
      });
      return reordered;
    });
  }

  const ready = images.length >= MIN_IMAGES;

  async function runAnalyst() {
    setAnalyzing(true);
    setAnalystResult(null);
    try {
      const res = await fetch('/api/style-analyst/run', { method: 'POST' });
      const j = await res.json();
      setAnalystResult(j);
    } catch (err) {
      setAnalystResult({ error: (err as Error).message });
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded p-10 text-center cursor-pointer transition ${
          isDragActive ? 'border-emerald-500 bg-emerald-950/20' : 'border-neutral-700 hover:border-neutral-500'
        } ${busy ? 'opacity-50' : ''}`}
      >
        <input {...getInputProps()} />
        <p className="text-neutral-300">
          {isDragActive ? 'Drop them.' : busy ? 'Uploading…' : 'Drop images, or click to choose. JPEG / PNG / WebP / HEIC.'}
        </p>
        <p className="text-xs text-neutral-500 mt-2">
          {images.length} / 100 uploaded — minimum {MIN_IMAGES} to run Style Analyst.
        </p>
      </div>

      {errors.length > 0 && (
        <div className="rounded border border-rose-700 bg-rose-950/30 p-3 text-sm text-rose-300">
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wide text-neutral-500">
          Portfolio ({images.length})
        </h2>
        <button
          onClick={runAnalyst}
          disabled={!ready || analyzing}
          className="rounded border border-neutral-700 px-4 py-2 text-sm disabled:opacity-40 hover:bg-neutral-800"
          title={ready ? 'Run Style Analyst' : `Need ${MIN_IMAGES - images.length} more image(s)`}
        >
          {analyzing ? 'Analyzing…' : 'Run Style Analyst →'}
        </button>
      </div>

      {analystResult != null && (
        <pre className="text-xs bg-neutral-950 border border-neutral-800 rounded p-3 overflow-auto max-h-96">
{JSON.stringify(analystResult, null, 2)}
        </pre>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={images.map((i) => i.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {images.map((img) => (
              <Tile key={img.id} img={img} onDelete={() => onDelete(img.id)} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function Tile({ img, onDelete }: { img: Image; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: img.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative aspect-square overflow-hidden rounded border border-neutral-800"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img.thumb_url}
        alt={img.filename}
        className="w-full h-full object-cover cursor-grab"
        {...attributes}
        {...listeners}
      />
      <button
        onClick={onDelete}
        className="absolute top-1 right-1 rounded bg-black/70 px-2 py-1 text-xs text-rose-300 opacity-0 group-hover:opacity-100"
      >
        delete
      </button>
    </div>
  );
}
