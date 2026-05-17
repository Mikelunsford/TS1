/**
 * stockService routing tests. Wave 8f / Phase 13. The stock_movements table
 * is APPEND-ONLY on the BE so only the adjustment mutation has a write path.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../apiClient', () => ({
  apiRequest: vi.fn(),
  ApiError: class extends Error {},
}));

import { apiRequest } from '../../apiClient';
import {
  adjustStock,
  listStockLevels,
  listStockMovements,
} from '../stockService';

const mock = vi.mocked(apiRequest);

beforeEach(() => {
  mock.mockReset();
  mock.mockResolvedValue({ items: [], next_cursor: null });
});

describe('stockService routing', () => {
  it('listStockLevels routes filters into the query', () => {
    void listStockLevels({
      warehouse_id: 'wh1',
      item_id: 'it1',
      low_stock: true,
    });
    const path = mock.mock.calls[0]?.[0]?.path ?? '';
    expect(path.startsWith('/inventory-api/stock-levels?')).toBe(true);
    expect(path).toContain('warehouse_id=wh1');
    expect(path).toContain('item_id=it1');
    expect(path).toContain('low_stock=true');
  });

  // R-W8F-OBS-02 — expand pass-through.
  it('listStockLevels routes expand=item into the query', () => {
    void listStockLevels({ expand: ['item'] });
    const path = mock.mock.calls[0]?.[0]?.path ?? '';
    expect(path).toContain('expand=item');
  });

  it('listStockMovements routes filters into the query', () => {
    void listStockMovements({
      warehouse_id: 'wh1',
      movement_type: 'adjustment',
      from: '2026-01-01T00:00:00Z',
    });
    const path = mock.mock.calls[0]?.[0]?.path ?? '';
    expect(path.startsWith('/inventory-api/stock-movements?')).toBe(true);
    expect(path).toContain('movement_type=adjustment');
    expect(path).toContain('warehouse_id=wh1');
    expect(path).toContain('from=2026-01-01T00');
  });

  it('adjustStock POSTs /stock-movements/adjustment with the signed delta', () => {
    void adjustStock({
      item_id: 'it1',
      warehouse_id: 'wh1',
      quantity_delta: -3,
      notes: 'audit fix',
    });
    const call = mock.mock.calls[0]?.[0];
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe('/inventory-api/stock-movements/adjustment');
    expect(call?.body).toMatchObject({ quantity_delta: -3, notes: 'audit fix' });
  });

  it('propagates errors from the underlying apiRequest', async () => {
    mock.mockRejectedValueOnce(new Error('boom'));
    await expect(listStockLevels()).rejects.toThrow('boom');
  });
});
