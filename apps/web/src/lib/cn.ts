/**
 * Minimal `cn` className combiner. Filters out falsy values and joins with
 * spaces. Wave 2 ships without `clsx`/`tailwind-merge`; we add those when the
 * design system bootstraps. See TS1/03-workspace/00-SHARED-CONTEXT.md
 * "Keep List" — `clsx`, `tailwind-merge` are queued for Wave 3 design-system.
 */
export function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter((c): c is string => typeof c === 'string' && c.length > 0).join(' ');
}
