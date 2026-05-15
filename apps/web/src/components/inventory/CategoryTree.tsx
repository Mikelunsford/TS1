import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/format';
import type { ItemCategory } from '@/lib/types';

/**
 * Render a flat list of `ItemCategory` rows as an expandable tree composed on
 * the client from `parent_id`. The list endpoint returns a flat array; the SPA
 * does the tree composition (see itemCategoriesService).
 *
 * Cycle safety: any node whose ancestor chain doesn't terminate at a root in
 * the input list is treated as a root (orphan). We never recurse without a
 * `seen` set, so a malformed `parent_id` loop can't hang the renderer.
 */

interface TreeNode {
  category: ItemCategory;
  children: TreeNode[];
}

function buildTree(categories: readonly ItemCategory[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const c of categories) {
    byId.set(c.id, { category: c, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const pid = node.category.parent_id;
    if (pid && byId.has(pid) && pid !== node.category.id) {
      byId.get(pid)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const cmp = (a: TreeNode, b: TreeNode) => a.category.label.localeCompare(b.category.label);
  const sort = (ns: TreeNode[]) => {
    ns.sort(cmp);
    for (const n of ns) sort(n.children);
  };
  sort(roots);
  return roots;
}

export interface CategoryTreeProps {
  categories: readonly ItemCategory[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Initial expand state. Default: roots collapsed. */
  defaultExpandedIds?: ReadonlySet<string>;
}

export function CategoryTree({
  categories,
  selectedId,
  onSelect,
  defaultExpandedIds,
}: CategoryTreeProps) {
  const tree = useMemo(() => buildTree(categories), [categories]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(defaultExpandedIds ?? []));

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (tree.length === 0) {
    return <p className="text-sm text-fg-muted">No categories yet.</p>;
  }

  return (
    <ul role="tree" className="text-sm">
      {tree.map((node) => (
        <CategoryNode
          key={node.category.id}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          selectedId={selectedId ?? null}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

interface NodeProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  selectedId: string | null;
  onSelect: ((id: string) => void) | undefined;
}

function CategoryNode({ node, depth, expanded, onToggle, selectedId, onSelect }: NodeProps) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.category.id);
  const isSelected = selectedId === node.category.id;
  return (
    <li role="treeitem" aria-expanded={hasChildren ? isOpen : undefined}>
      <div
        className={cn(
          'flex items-center gap-1 rounded-md px-2 py-1',
          isSelected ? 'bg-bg-muted ring-1 ring-border-strong' : 'hover:bg-bg-muted',
        )}
        style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.category.id)}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            className="rounded p-0.5 text-fg-muted hover:text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="inline-block w-[1.125rem]" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => onSelect?.(node.category.id)}
          className={cn(
            'flex-1 text-left focus:outline-none focus:ring-2 focus:ring-brand',
            isSelected ? 'font-medium text-fg' : 'text-fg-muted hover:text-fg',
          )}
        >
          {node.category.label}
          {!node.category.is_active && (
            <span className="ml-2 text-xs uppercase tracking-wide text-fg-subtle">(inactive)</span>
          )}
        </button>
      </div>
      {hasChildren && isOpen && (
        <ul role="group">
          {node.children.map((child) => (
            <CategoryNode
              key={child.category.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
