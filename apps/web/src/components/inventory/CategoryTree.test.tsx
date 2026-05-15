import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CategoryTree } from './CategoryTree';
import type { ItemCategory } from '@/lib/types';

function cat(id: string, label: string, parent_id: string | null = null): ItemCategory {
  return {
    id,
    org_id: '00000000-0000-0000-0000-000000000aaa',
    code: id,
    label,
    parent_id,
    is_active: true,
    created_at: '2026-05-15T00:00:00.000Z',
    updated_at: '2026-05-15T00:00:00.000Z',
  };
}

describe('CategoryTree', () => {
  it('composes a tree from a flat list (children render under their parent when expanded)', () => {
    const categories: ItemCategory[] = [
      cat('00000000-0000-0000-0000-000000000001', 'Hardware'),
      cat('00000000-0000-0000-0000-000000000002', 'Screws', '00000000-0000-0000-0000-000000000001'),
      cat('00000000-0000-0000-0000-000000000003', 'Bolts', '00000000-0000-0000-0000-000000000001'),
      cat('00000000-0000-0000-0000-000000000004', 'Software'),
    ];
    // Pre-expand the Hardware root so children render up front.
    render(
      <CategoryTree
        categories={categories}
        defaultExpandedIds={new Set(['00000000-0000-0000-0000-000000000001'])}
      />,
    );
    expect(screen.getByText('Hardware')).toBeInTheDocument();
    expect(screen.getByText('Software')).toBeInTheDocument();
    // Children visible because Hardware is expanded.
    expect(screen.getByText('Screws')).toBeInTheDocument();
    expect(screen.getByText('Bolts')).toBeInTheDocument();
  });

  it('toggles collapse/expand via the chevron control', () => {
    const categories: ItemCategory[] = [
      cat('00000000-0000-0000-0000-000000000001', 'Hardware'),
      cat('00000000-0000-0000-0000-000000000002', 'Screws', '00000000-0000-0000-0000-000000000001'),
    ];
    render(<CategoryTree categories={categories} />);
    // Default: collapsed — child not in DOM.
    expect(screen.queryByText('Screws')).toBeNull();
    // Click Expand button.
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByText('Screws')).toBeInTheDocument();
    // Collapse again.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(screen.queryByText('Screws')).toBeNull();
  });
});
