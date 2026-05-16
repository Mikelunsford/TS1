/**
 * JEWorkflowButtons — Post / Reverse buttons gated on transition legality
 * (`canTransition('journal_entry', from, to)`) AND capability
 * (`finance.journal_entries.post` / `.reverse`).
 *
 * Both actions are cap-checked via the broader `finance.*` ALLOW for
 * accounting role; the cap strings still match the BE policy mirror.
 *
 * Workflow target mapping (per `JOURNAL_ENTRY_TRANSITIONS`):
 *   Post     : draft → posted          (BE asserts balance via RPC)
 *   Reverse  : draft|posted → reversed (BE creates flipped mirror entry
 *                                       on posted; on draft it just stamps)
 */
import { WorkflowButton } from '@/components/procurement/WorkflowButton';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { canTransition, type JournalEntryState } from '@/lib/workflow';

export interface JEWorkflowButtonsProps {
  status: JournalEntryState;
  onPost: () => void;
  onReverse: () => void;
  pending?: { post?: boolean; reverse?: boolean };
}

export function JEWorkflowButtons({
  status,
  onPost,
  onReverse,
  pending = {},
}: JEWorkflowButtonsProps) {
  const { can } = useCapabilities();

  const isReal = (target: JournalEntryState) =>
    status !== target && canTransition('journal_entry', status, target);

  const showPost = can('finance.journal_entries.post') && isReal('posted');
  const showReverse = can('finance.journal_entries.reverse') && isReal('reversed');

  return (
    <div className="flex flex-wrap gap-2" data-testid="je-workflow-buttons">
      {showPost && (
        <WorkflowButton
          data-testid="je-action-post"
          variant="primary"
          onClick={onPost}
          pending={pending.post ?? false}
        >
          Post
        </WorkflowButton>
      )}
      {showReverse && (
        <WorkflowButton
          data-testid="je-action-reverse"
          variant="danger"
          onClick={onReverse}
          pending={pending.reverse ?? false}
        >
          Reverse…
        </WorkflowButton>
      )}
    </div>
  );
}
