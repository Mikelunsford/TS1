import { ActivityFeed } from '@/components/crm/ActivityFeed';

/**
 * Global activity feed across all entity types in the active org. Per-entity
 * timelines render through the same `<ActivityFeed>` component on the
 * customer detail page (Activities tab).
 */
export default function ActivitiesFeedPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Activities</h1>
        <p className="text-sm text-fg-muted">
          Recent calls, meetings, emails, notes, and tasks logged across CRM entities.
        </p>
      </header>
      <ActivityFeed />
    </div>
  );
}
