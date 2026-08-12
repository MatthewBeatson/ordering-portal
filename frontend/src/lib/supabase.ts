import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set');
}

// Anon key only, by design -- this app never holds the service_role
// key or any Cin7 credential. Reads go through this client under RLS;
// writes go through the backend API (see lib/api.ts).
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Dev-only escape hatch so a session obtained out-of-band (e.g. via the
// Admin API for local testing) can be injected with supabase.auth.setSession
// instead of hand-writing localStorage's internal format. Stripped from
// production builds by the import.meta.env.DEV guard.
if (import.meta.env.DEV) {
  (window as unknown as { __supabase: typeof supabase }).__supabase = supabase;
}

const PRODUCT_IMAGE_BUCKET = 'product-images';

export function productImageUrl(storagePath: string | null | undefined) {
  if (!storagePath) return null;
  if (/^https?:\/\//i.test(storagePath)) return storagePath;
  const { data } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(storagePath.replace(/^\/+/, ''));
  return data.publicUrl;
}
