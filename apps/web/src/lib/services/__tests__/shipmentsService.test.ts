/**
 * shipmentsService routing tests. Wave 8f / Phase 13.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../apiClient', () => ({
  apiRequest: vi.fn(),
  ApiError: class extends Error {},
}));

import { apiRequest } from '../../apiClient';
import {
  cancelShipment,
  createShipment,
  getShipment,
  listShipments,
  shipShipment,
  startLoadingShipment,
  updateShipment,
} from '../shipmentsService';

const mock = vi.mocked(apiRequest);

beforeEach(() => {
  mock.mockReset();
  mock.mockResolvedValue({ items: [], next_cursor: null });
});

describe('shipmentsService routing', () => {
  it('listShipments GETs /ops-api/shipments', () => {
    void listShipments({ status: 'loading' });
    const path = mock.mock.calls[0]?.[0]?.path ?? '';
    expect(path.startsWith('/ops-api/shipments')).toBe(true);
    expect(path).toContain('status=loading');
  });

  it('getShipment hits /:id', () => {
    void getShipment('abc');
    expect(mock.mock.calls[0]?.[0]?.path).toBe('/ops-api/shipments/abc');
  });

  it('createShipment POSTs the body including carrier_name', () => {
    void createShipment({ project_id: 'p1', qty_shipped: 1, carrier_name: 'UPS' });
    const call = mock.mock.calls[0]?.[0];
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe('/ops-api/shipments');
    expect(call?.body).toMatchObject({ carrier_name: 'UPS' });
  });

  it('updateShipment PATCHes', () => {
    void updateShipment('abc', { tracking_number: 'TRACK123' });
    expect(mock.mock.calls[0]?.[0]?.method).toBe('PATCH');
  });

  it('startLoadingShipment POSTs /:id/start-loading', () => {
    void startLoadingShipment('abc');
    expect(mock.mock.calls[0]?.[0]?.path).toBe('/ops-api/shipments/abc/start-loading');
  });

  it('shipShipment POSTs /:id/ship', () => {
    void shipShipment('abc');
    expect(mock.mock.calls[0]?.[0]?.path).toBe('/ops-api/shipments/abc/ship');
  });

  it('cancelShipment POSTs /:id/cancel and forwards optional reason', () => {
    void cancelShipment('abc', { cancellation_reason: 'oops' });
    const call = mock.mock.calls[0]?.[0];
    expect(call?.path).toBe('/ops-api/shipments/abc/cancel');
    expect(call?.body).toEqual({ cancellation_reason: 'oops' });
  });

  it('cancelShipment sends {} when no body provided', () => {
    void cancelShipment('abc');
    expect(mock.mock.calls[0]?.[0]?.body).toEqual({});
  });

  it('propagates errors from the underlying apiRequest', async () => {
    mock.mockRejectedValueOnce(new Error('boom'));
    await expect(shipShipment('x')).rejects.toThrow('boom');
  });
});
