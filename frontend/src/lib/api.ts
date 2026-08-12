import { supabase } from './supabase';
import type { Order } from './types';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session has expired. Please sign in again.');
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await authHeader();
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const p = payload as { error?: string; details?: unknown } | null;
    const message = p?.error || `Request failed (${res.status})`;
    const details = typeof p?.details === 'string' ? p.details : p?.details ? JSON.stringify(p.details) : undefined;
    throw new Error(details ? `${message} — ${details}` : message);
  }

  return payload as T;
}

export interface CreateOrderInput {
  store_id: string;
  notes?: string;
  lines: Array<{ sku: string; description?: string; quantity: number; unit_price?: number }>;
}

export const ordersApi = {
  create: (input: CreateOrderInput) => request<Order>('POST', '/orders', input),
  list: (params: { status?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.offset != null) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return request<{ orders: Order[]; total: number; limit: number; offset: number }>('GET', `/orders${q ? `?${q}` : ''}`);
  },
  get: (id: string) => request<Order>('GET', `/orders/${id}`),
  remove: (id: string) => request<void>('DELETE', `/orders/${id}`),
  confirm: (id: string) => request<Order>('POST', `/orders/${id}/confirm`),
  bulkConfirm: (orderIds: string[]) =>
    request<{ confirmed: Order[]; skipped: { id: string; reason: string }[]; not_found: string[] }>('POST', '/orders/bulk/confirm', {
      order_ids: orderIds,
    }),
  reject: (id: string, reason?: string) => request<Order>('POST', `/orders/${id}/reject`, { reason }),
  requestCancellation: (id: string, reason?: string) => request<Order>('POST', `/orders/${id}/request-cancellation`, { reason }),
  retrySync: (id: string) => request<Order>('POST', `/orders/${id}/retry-sync`),
};

export interface PortalProductResult {
  client_id: string;
  product_id: string;
  added_to_portal: boolean;
}

export const productsApi = {
  sync: () => request<{ synced: number; failed: number; total: number }>('POST', '/products/sync'),
  addToPortal: (id: string, clientId: string) => request<PortalProductResult>('POST', `/products/${id}/add-to-portal`, { client_id: clientId }),
  removeFromPortal: (id: string, clientId: string) =>
    request<PortalProductResult>('POST', `/products/${id}/remove-from-portal`, { client_id: clientId }),
  bulkAddToPortal: (productIds: string[], clientId: string) =>
    request<{ client_id: string; added: { product_id: string }[] }>('POST', '/products/bulk/add-to-portal', {
      product_ids: productIds,
      client_id: clientId,
    }),
};

export interface ManageableStore {
  id: string;
  name: string;
  store_number: string | null;
  client_id: string;
  clients: { name: string } | null;
}

export interface CreateStoreInput {
  client_id: string;
  name: string;
  store_number?: string;
  cin7_address_line1: string;
  cin7_address_line2?: string;
  cin7_address_city?: string;
  cin7_address_state?: string;
  cin7_address_postcode?: string;
  cin7_address_country?: string;
}

export const storesApi = {
  listManageable: () => request<{ stores: ManageableStore[] }>('GET', '/stores'),
  updateStoreNumber: (id: string, storeNumber: string) =>
    request<ManageableStore>('PATCH', `/stores/${id}/store-number`, { store_number: storeNumber }),
  create: (input: CreateStoreInput) => request<ManageableStore>('POST', '/stores', input),
};

export interface ManageableClient {
  id: string;
  name: string;
}

export const clientsApi = {
  listManageable: () => request<{ clients: ManageableClient[] }>('GET', '/clients'),
};
