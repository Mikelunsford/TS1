import { cn } from '@/lib/format';
import type { CustomerKind } from '@/lib/types';

/**
 * Compact <select> for customer kind = company | individual. We intentionally
 * use the native element here rather than a Radix Select primitive — this
 * picker is used inline in list filters where keyboard + screen-reader
 * behavior of the native control is enough, and Radix Select is not yet in
 * the dep tree on this branch. When the Radix Select primitive lands as
 * part of the design-system extension, swap this implementation.
 */
export function ClientTypePicker({
  value,
  onChange,
  includeAll = false,
  id,
  className,
}: {
  value: CustomerKind | 'all';
  onChange: (v: CustomerKind | 'all') => void;
  includeAll?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as CustomerKind | 'all')}
      className={cn(
        'rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand',
        className,
      )}
      aria-label="Customer kind"
    >
      {includeAll && <option value="all">All kinds</option>}
      <option value="company">Company</option>
      <option value="individual">Individual</option>
    </select>
  );
}
