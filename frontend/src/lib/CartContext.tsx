import * as React from 'react';
import type { CartLine } from './types';

// A cart isn't a server-side concept -- it's local state until
// "submit order" fires a single POST /orders with a lines[] array.
interface CartState {
  storeId: string | null;
  lines: CartLine[];
  setStore: (storeId: string) => void;
  addLine: (line: CartLine) => void;
  removeLine: (sku: string) => void;
  setQuantity: (sku: string, quantity: number) => void;
  clear: () => void;
  count: number;
}

const CartContext = React.createContext<CartState | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [storeId, setStoreId] = React.useState<string | null>(null);
  const [lines, setLines] = React.useState<CartLine[]>([]);

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

  const count = lines.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <CartContext.Provider value={{ storeId, lines, setStore, addLine, removeLine, setQuantity, clear, count }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = React.useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
