export type OrderStatus = 'pending' | 'confirmed' | 'in_progress' | 'shipped' | 'delivered' | 'rejected';

export interface OrderLine {
  id: string;
  order_id: string;
  sku: string;
  description: string | null;
  quantity: number;
  unit_price: number | null;
  created_at: string;
}

export interface InventorySync {
  provider: string;
  status: 'synced' | 'failed';
  external_id: string | null;
  error_message: string | null;
  synced_at: string | null;
}

export interface Order {
  id: string;
  store_id: string;
  requested_by: string;
  approved_by: string | null;
  status: OrderStatus;
  notes: string | null;
  reference: string | null;
  shipped_at: string | null;
  shipped_source: string | null;
  created_at: string;
  updated_at: string;
  order_lines?: OrderLine[];
  // Staff-only -- present only when the signed-in user is_portal_admin
  // (see sanitizeOrder in backend/src/services/orders.js). null means
  // no sync has been attempted yet.
  inventory_sync?: InventorySync | null;
}

export interface Store {
  id: string;
  name: string;
  client_id: string;
  store_number: string | null;
}

export interface Client {
  id: string;
  name: string;
  cin7_price_tier: string | null;
  show_pricing: boolean;
}

export interface ProductType {
  id: string;
  name: string;
  display_order: number;
}

export interface ProductJewelleryType {
  id: string;
  name: string;
  display_order: number;
}

export interface ProductColour {
  id: string;
  name: string;
  display_order: number;
}

export interface DisplaySystem {
  id: string;
  name: string;
  cin7_category_value: string | null;
  display_order: number;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  product_type_id: string | null;
  jewellery_type_id: string | null;
  colour_id: string | null;
  display_system_id: string | null;
  is_active: boolean;
  price_tier_1: number | null;
  price_tier_2: number | null;
  price_tier_3: number | null;
  price_tier_4: number | null;
  price_tier_5: number | null;
  price_tier_6: number | null;
  price_tier_7: number | null;
  price_tier_8: number | null;
  price_tier_9: number | null;
  price_tier_10: number | null;
}

export interface ProductImage {
  id: string;
  product_id: string;
  storage_path: string;
  alt_text: string | null;
  display_order: number;
}

export interface ClientProductSku {
  client_id: string;
  product_id: string;
  client_sku: string;
}

// Per-(client, product) overrides (022, extended by 024). null in any
// field means "no override for this client -- use the product's
// global value," never zero/empty.
export interface ClientProductAttributeOverride {
  client_id: string;
  product_id: string;
  jewellery_count: number | null;
  product_type_id: string | null;
  jewellery_type_id: string | null;
  colour_id: string | null;
}

export interface ClientAddress {
  id: string;
  client_id: string;
  cin7_address_id: string;
  type: string;
  is_default: boolean;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
}

export interface CartLine {
  sku: string;
  description?: string;
  quantity: number;
  unit_price?: number;
}
