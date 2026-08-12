import * as React from 'react';
import type { CartLine } from './types';

// A cart isn't a server-side concept -- it's local state until
// "submit order" fires a single POST /orders with a lines[] array.
//
// editingOrderId being set means this cart is standing in for an
// EXISTING pending order's lines rather than building a new one --
// Cart.tsx hydrates lines/notes from that order on load and calls
// PATCH /orders/:id instead of POST /orders on save. Kept as just an
// id (not the whole order) so Cart.tsx stays the single place that
// fetches/owns the order data being edited.
interface CartState {
  storeId: string | null;
  lines: CartLine[];
  editingOrderId: string | null;
  setStore: (storeId: string) => void;
  addLine: (line: CartLine) => void;
  removeLine: (sku: string) => void;
  setQuantity: (sku: string, quantity: number) => void;
  clear: () => void;
  count: number;
  startEditingOrder: (orderId: string, storeId: string) => void;
  stopEditing: () => void;
}

const CartContext = React.createContext<CartState | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [storeId, setStoreId] = React.useState<string | null>(null);
  const [lines, setLines] = React.useState<CartLine[]>([]);
  const [editingOrderId, setEditingOrderId] = React.useState<string | null>(null);

  const setStore = React.useCallback((id: string) => setStoreId(id), []);

  const addLine = React.useCallback((line: CartLine) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.sku === line.sku);
      if (existing) {
        return prev.map((l) => (l.sku === line.sku ? { ...l, quantity: l.quantity + line.quantity } : l));
      }
      return [...prev, line];
    });
  }, []);

  const removeLine = React.useCallback((sku: string) => {
    setLines((prev) => prev.filter((l) => l.sku !== sku));
  }, []);

  const setQuantity = React.useCallback((sku: string, quantity: number) => {
    setLines((prev) => prev.map((l) => (l.sku === sku ? { ...l, quantity } : l)));
  }, []);

  const clear = React.useCallback(() => setLines([]), []);

  // Clears any current cart lines so the edited order's own lines are
  // the only thing hydrated in -- Cart.tsx fetches the order and
  // populates from scratch once this is set.
  const startEditingOrder = React.useCallback((orderId: string, newStoreId: string) => {
    setEditingOrderId(orderId);
    setStoreId(newStoreId);
    setLines([]);
  }, []);

  const stopEditing = React.useCallback(() => {
    setEditingOrderId(null);
  }, []);

  const count = lines.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <CartContext.Provider
      value={{ storeId, lines, editingOrderId, setStore, addLine, removeLine, setQuantity, clear, count, startEditingOrder, stopEditing }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = React.useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
