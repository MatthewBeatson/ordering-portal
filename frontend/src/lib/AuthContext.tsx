import * as React from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

interface StoreRole {
  store_id: string;
  role: 'buyer' | 'store_admin';
}
interface ClientRole {
  client_id: string;
  role: 'client_admin';
}

interface AuthState {
  session: Session | null;
  loading: boolean;
  isPortalAdmin: boolean;
  storeRoles: StoreRole[];
  clientRoles: ClientRole[];
  accessibleStoreIds: Set<string>;
  /** Whether the current user can approve orders for the given store — mirrors the backend's can_approve() logic, for UI display only. The backend re-checks this for real via RPC on every write. */
  canApprove: (storeId: string) => boolean;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
}

const AuthContext = React.createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [isPortalAdmin, setIsPortalAdmin] = React.useState(false);
  const [storeRoles, setStoreRoles] = React.useState<StoreRole[]>([]);
  const [clientRoles, setClientRoles] = React.useState<ClientRole[]>([]);
  const [accessibleStoreIds, setAccessibleStoreIds] = React.useState<Set<string>>(new Set());

  const resolveRoles = React.useCallback(async (userId: string) => {
    const [{ data: userRow }, { data: storeRoleRows }, { data: clientRoleRows }] = await Promise.all([
      supabase.from('users').select('is_portal_admin').eq('id', userId).maybeSingle(),
      supabase.from('user_store_roles').select('store_id, role').eq('user_id', userId),
      supabase.from('user_client_roles').select('client_id, role').eq('user_id', userId),
    ]);

    const admin = userRow?.is_portal_admin === true;
    const stores = (storeRoleRows ?? []) as StoreRole[];
    const clients = (clientRoleRows ?? []) as ClientRole[];

    let accessible = new Set(stores.map((r) => r.store_id));
    if (admin) {
      const { data: allStores } = await supabase.from('stores').select('id');
      accessible = new Set((allStores ?? []).map((s) => s.id as string));
    } else if (clients.length > 0) {
      const { data: clientStores } = await supabase
        .from('stores')
        .select('id')
        .in(
          'client_id',
          clients.map((c) => c.client_id)
        );
      for (const s of clientStores ?? []) accessible.add(s.id as string);
    }

    setIsPortalAdmin(admin);
    setStoreRoles(stores);
    setClientRoles(clients);
    setAccessibleStoreIds(accessible);
  }, []);

  const refreshRoles = React.useCallback(async () => {
    if (session?.user) await resolveRoles(session.user.id);
  }, [session, resolveRoles]);

  React.useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session?.user) {
        resolveRoles(data.session.user.id).finally(() => active && setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        setLoading(true);
        resolveRoles(newSession.user.id).finally(() => setLoading(false));
      } else {
        setIsPortalAdmin(false);
        setStoreRoles([]);
        setClientRoles([]);
        setAccessibleStoreIds(new Set());
        setLoading(false);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [resolveRoles]);

  const canApprove = React.useCallback(
    (storeId: string) => {
      if (isPortalAdmin) return true;
      if (storeRoles.some((r) => r.store_id === storeId && r.role === 'store_admin')) return true;
      // Client-admin approval cascades to every store under their client;
      // we don't have client_id-per-store cached here, so this is a
      // conservative UI hint only -- backend RPC is the real check.
      return clientRoles.length > 0;
    },
    [isPortalAdmin, storeRoles, clientRoles]
  );

  const signOut = React.useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value: AuthState = {
    session,
    loading,
    isPortalAdmin,
    storeRoles,
    clientRoles,
    accessibleStoreIds,
    canApprove,
    signOut,
    refreshRoles,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
