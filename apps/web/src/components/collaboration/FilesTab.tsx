/**
 * FilesTab — universal files surface for any entity.
 *
 * Phase 16 (Wave 10 Session 2) — B1 owns this block.
 *
 * Upload flow: SPA POSTs /attachments/sign-upload, uploads the bytes to
 * Storage via the supabase-js helper, then POSTs /attachments to persist
 * the metadata. This component just orchestrates that via uploadAttachment().
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { collaborationKeys } from '@/lib/queryKeys/collaboration';
import {
  listAttachments,
  signDownload,
  softDeleteAttachment,
  uploadAttachment,
  type Attachment,
  type CollabEntityType,
} from '@/lib/services/collaborationService';

interface Props {
  entityType: CollabEntityType;
  entityId: string;
}

function formatSize(bytes?: number | null): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilesTab({ entityType, entityId }: Props) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const query = useQuery({
    queryKey: collaborationKeys.attachments(entityType, entityId),
    queryFn: () => listAttachments(entityType, entityId),
    staleTime: 10_000,
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadAttachment({ entity_type: entityType, entity_id: entityId, file }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: collaborationKeys.attachments(entityType, entityId) }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => softDeleteAttachment(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: collaborationKeys.attachments(entityType, entityId) }),
  });

  async function handleDownload(att: Attachment) {
    const { signed_url } = await signDownload(att.id);
    window.open(signed_url, '_blank', 'noopener');
  }

  async function handleFiles(list: FileList | null) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const f = list.item(i);
      if (f) await upload.mutateAsync(f);
    }
  }

  if (query.isLoading) return <Skeleton className="h-32 w-full" />;
  if (query.error) return <ErrorState title="Could not load files" error={query.error} />;

  const items = query.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(e.dataTransfer?.files ?? null);
        }}
        className={`rounded-md border-2 border-dashed p-4 text-center text-sm ${dragOver ? 'border-brand bg-bg-subtle' : 'border-border text-fg-muted'}`}
      >
        <p>
          Drag and drop files here, or{' '}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="font-medium text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
          >
            browse
          </button>
          .
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        {upload.isPending && <p className="mt-1 text-xs">Uploading…</p>}
        {upload.error && (
          <p role="alert" className="mt-1 text-xs text-error">
            {(upload.error as Error).message}
          </p>
        )}
      </div>

      {items.length === 0 && (
        <EmptyState
          title="No files yet"
          description="Attach contracts, photos, specs — anything related to this record."
        />
      )}

      {items.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-fg">{a.file_name}</p>
                <p className="text-xs text-fg-subtle">
                  {a.mime_type ?? 'unknown'} • {formatSize(a.size_bytes)} •{' '}
                  {new Date(a.created_at).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleDownload(a)}
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-bg-subtle"
              >
                Download
              </button>
              <button
                type="button"
                onClick={() => remove.mutate(a.id)}
                className="rounded-md border border-border px-2 py-1 text-xs text-fg-muted hover:bg-bg-subtle"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
