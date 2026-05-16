/**
 * CommentsTab — universal threaded comments + @mentions UI.
 *
 * Phase 16 (Wave 10 Session 2) — B1 owns this block.
 *
 * Props: entityType + entityId. Renders the thread list, a composer with
 * @mention autocomplete, and reply controls. Comments are read-only from
 * a UI-flow perspective once posted (author-only inline edit/delete; the
 * permission check happens on the BE — UI just shows the buttons for the
 * caller's own rows).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { collaborationKeys } from '@/lib/queryKeys/collaboration';
import {
  createComment,
  listComments,
  softDeleteComment,
  type CollabEntityType,
  type Comment,
  type MentionUser,
} from '@/lib/services/collaborationService';

import { MentionAutocomplete } from './MentionAutocomplete';

interface Props {
  entityType: CollabEntityType;
  entityId: string;
}

interface CommentsTree {
  roots: Comment[];
  childrenByParent: Record<string, Comment[]>;
}

function toTree(items: Comment[]): CommentsTree {
  const roots: Comment[] = [];
  const childrenByParent: Record<string, Comment[]> = {};
  for (const c of items) {
    if (c.parent_comment_id) {
      (childrenByParent[c.parent_comment_id] ??= []).push(c);
    } else {
      roots.push(c);
    }
  }
  return { roots, childrenByParent };
}

export function CommentsTab({ entityType, entityId }: Props) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: collaborationKeys.comments(entityType, entityId),
    queryFn: () => listComments(entityType, entityId),
    staleTime: 10_000,
  });

  const tree = useMemo(() => toTree(query.data?.items ?? []), [query.data]);

  const [replyTo, setReplyTo] = useState<string | null>(null);

  if (query.isLoading) return <Skeleton className="h-32 w-full" />;
  if (query.error) return <ErrorState title="Could not load comments" error={query.error} />;

  const roots = tree.roots;

  return (
    <div className="space-y-4">
      {roots.length === 0 && (
        <EmptyState
          title="No comments yet"
          description="Start the conversation. Type @ to mention a teammate."
        />
      )}

      <ul className="space-y-3">
        {roots.map((c) => (
          <li key={c.id} className="rounded-md border border-border bg-bg-subtle/40 p-3">
            <CommentRow
              comment={c}
              onReply={() => setReplyTo(replyTo === c.id ? null : c.id)}
              onDelete={async () => {
                await softDeleteComment(c.id);
                await qc.invalidateQueries({ queryKey: collaborationKeys.comments(entityType, entityId) });
              }}
            />
            {(tree.childrenByParent[c.id] ?? []).length > 0 && (
              <ul className="mt-3 space-y-2 border-l border-border pl-3">
                {(tree.childrenByParent[c.id] ?? []).map((r) => (
                  <li key={r.id}>
                    <CommentRow
                      comment={r}
                      onDelete={async () => {
                        await softDeleteComment(r.id);
                        await qc.invalidateQueries({ queryKey: collaborationKeys.comments(entityType, entityId) });
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
            {replyTo === c.id && (
              <div className="mt-3">
                <CommentComposer
                  entityType={entityType}
                  entityId={entityId}
                  parentCommentId={c.id}
                  onPosted={() => setReplyTo(null)}
                />
              </div>
            )}
          </li>
        ))}
      </ul>

      <CommentComposer entityType={entityType} entityId={entityId} />
    </div>
  );
}

function CommentRow({
  comment,
  onReply,
  onDelete,
}: {
  comment: Comment;
  onReply?: () => void;
  onDelete?: () => void;
}) {
  const author = comment.author?.display_name ?? comment.author?.email ?? 'Member';
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2 text-xs text-fg-subtle">
        <span className="font-medium text-fg">{author}</span>
        <time dateTime={comment.created_at}>
          {new Date(comment.created_at).toLocaleString()}
        </time>
        {comment.edited_at && <span>(edited)</span>}
      </div>
      <p className="whitespace-pre-wrap text-sm text-fg">{comment.body}</p>
      <div className="flex gap-3 text-xs">
        {onReply && (
          <button
            type="button"
            onClick={onReply}
            className="text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
          >
            Reply
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="text-fg-muted hover:text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

interface ComposerProps {
  entityType: CollabEntityType;
  entityId: string;
  parentCommentId?: string;
  onPosted?: () => void;
}

function CommentComposer({ entityType, entityId, parentCommentId, onPosted }: ComposerProps) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<MentionUser[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createComment({
        entity_type: entityType,
        entity_id: entityId,
        body,
        mentions: mentions.map((m) => m.user_id),
        parent_comment_id: parentCommentId ?? null,
      }),
    onSuccess: async () => {
      setBody('');
      setMentions([]);
      setMentionQuery(null);
      await qc.invalidateQueries({ queryKey: collaborationKeys.comments(entityType, entityId) });
      onPosted?.();
    },
  });

  function handleChange(value: string) {
    setBody(value);
    // detect open @-token at the caret: simple last-`@` heuristic.
    const m = /@([\w.-]*)$/.exec(value);
    if (m) setMentionQuery(m[1] ?? '');
    else setMentionQuery(null);
  }

  function applyMention(u: MentionUser) {
    const handle = (u.display_name ?? u.email ?? u.user_id).replace(/\s+/g, '');
    setBody((b) => b.replace(/@([\w.-]*)$/, `@${handle} `));
    setMentions((prev) => (prev.some((p) => p.user_id === u.user_id) ? prev : [...prev, u]));
    setMentionQuery(null);
    textareaRef.current?.focus();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim().length === 0) return;
        mutation.mutate();
      }}
      className="relative space-y-2"
    >
      <label className="sr-only" htmlFor="comment-body">
        Comment
      </label>
      <textarea
        ref={textareaRef}
        id="comment-body"
        value={body}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={parentCommentId ? 'Write a reply… (@ to mention)' : 'Add a comment… (@ to mention)'}
        rows={parentCommentId ? 2 : 3}
        className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
      />
      <MentionAutocomplete
        query={mentionQuery ?? ''}
        open={mentionQuery !== null}
        onPick={applyMention}
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={body.trim().length === 0 || mutation.isPending}
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-40"
        >
          {mutation.isPending ? 'Posting…' : parentCommentId ? 'Reply' : 'Post'}
        </button>
        {mentions.length > 0 && (
          <span className="text-xs text-fg-muted">
            Mentioning {mentions.length}
          </span>
        )}
        {mutation.error && (
          <span role="alert" className="text-xs text-error">
            {(mutation.error as Error).message}
          </span>
        )}
      </div>
    </form>
  );
}
