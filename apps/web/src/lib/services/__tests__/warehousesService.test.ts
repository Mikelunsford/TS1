/**
 * warehousesService routing tests. Wave 8f / Phase 13.
 *
 * Verifies that each exported call hits the expected path + method against
 * the inventory-api bundle. Body is passed through verbatim — the BE owns
 * Zod validation, so the SPA only proves URL routing here.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../apiClient', () => ({
  apiRequest: vi.fn(),
  ApiError: class extends Error {},
}));

import { apiRequest } from '../../apiClient';
import {
  archiveWarehouse,
  createWarehouse,
  getWarehouse,
  listWarehouses,
  updateWarehouse,
} from '../warehousesService';

const mock = vi.mocked(apiRequest);

beforeEach(() => {
  mock.mockReset();
  mock.mockResolvedValue({ items: [], next_cursor: null });
});

describe('warehousesService routing', () => {
  it('listWarehouses GETs /inventory-api/warehouses with serialized filters', () => {
    void listWarehouses({ q: 'main', is_active: true, limit: 25 });
    const call = mock.mock.calls[0]?.[0];
    expect(call?.method).toBe('GET');
    expect(call?.path).toBe('/inventory-api/warehouses?q=main&is_active=true&limit=25');
  });

  it('getWarehouse GETs /inventory-api/warehouses/:id', () => {
    void getWarehouse('abc-123');
    expect(mock.mock.calls[0]?.[0]?.path).toBe('/inventory-api/warehouses/abc-123');
  });

  it('createWarehouse POSTs and forwards the body', () => {
    void createWarehouse({ code: 'MAIN', label: 'Main warehouse' });
    const call = mock.mock.calls[0]?.[0];
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe('/inventory-api/warehouses');
    expect(call?.body).toEqual({ code: 'MAIN', label: 'Main warehouse' });
  });

  it('updateWarehouse PATCHes :id', () => {
    void updateWarehouse('abc', { label: 'Renamed' });
    const call = mock.mock.calls[0]?.[0];
    expect(call?.method).toBe('PATCH');
    expect(call?.path).toBe('/inventory-api/warehouses/abc');
  });

  it('archiveWarehouse POSTs the /archive subroute', () => {
    void archiveWarehouse('abc');
    const call = mock.mock.calls[0]?.[0];
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe('/inventory-api/warehouses/abc/archive');
  });

  it('propagates errors from the underlying apiRequest', async () => {
    mock.mockRejectedValueOnce(new Error('boom'));
    await expect(getWarehouse('x')).rejects.toThrow('boom');
  });
});
