import * as React from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { setMfaRequiredHandler, type MfaRequiredCode } from './mfaSignal';

const MFA_REVERIFY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

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
  isSuperAdmin: boolean;
  storeRoles: StoreRole[];
  clientRoles: ClientRole[];
  accessibleStoreIds: Set<string>;
  /** The client company/companies the signed-in user belongs to (via a direct client_admin role, or through their store's client) — null for staff, who aren't scoped to one company. Display-only; access itself is still governed by storeRoles/clientRoles/RLS. */
  companyName: string | null;
  /** Whether the current user can approve orders for the given store — mirrors the backend's can_approve() logic, for UI display only. The backend re-checks this for real via RPC on every write. */
  canApprove: (storeId: string) => boolean;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
  /** Staff-only (is_portal_admin). Weekly TOTP requirement -- see backend/src/lib/mfa.js for the authoritative check this mirrors. */
  mfaRequired: MfaRequiredCode | null;
  /** Re-checks MFA status after a successful enroll/challenge, clearing mfaRequired if satisfied. */
  refreshMfaStatus: () => Promise<void>;
  /** Catalog/Cart/OrderDetail's shared image-size toggle -- persisted per-user (see 021_user_image_size_preference.sql) so it's the same on next login, any device. 'small' until the real value loads. */
  imageSizePreference: 'hide' | 'small' | 'large';
  setImageSizePreference: (v: 'hide' | 'small' | 'large') => void;
}

const AuthContext = React.createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [isPortalAdmin, setIsPortalAdmin] = React.useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = React.useState(false);
  const [storeRoles, setStoreRoles] = React.useState<StoreRole[]>([]);
  const [clientRoles, setClientRoles] = React.useState<ClientRole[]>([]);
  const [accessibleStoreIds, setAccessibleStoreIds] = React.useState<Set<string>>(new Set());
  const [mfaRequired, setMfaRequired] = React.useState<MfaRequiredCode | null>(null);
  const [companyName, setCompanyName] = React.useState<string | null>(null);
  const [imageSizePreference, setImageSizePreferenceState] = React.useState<'hide' | 'small' | 'large'>('small');

  // Proactive check, only meaningful for staff -- best-effort: Supabase's
  // self-listFactors() doesn't reliably surface last_challenged_at, so
  // this can only reliably detect "never enrolled", not "enrolled but
  // stale". Staleness is still caught for real by the reactive path
  // below (any backend 403 with an MFA_* code), which is the
  // authoritative check either way -- this just avoids a guaranteed
  // round-trip to the backend before showing the gate when we can tell
  // enrollment is missing outright.
  const checkMfaStatus = React.useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    const verifiedTotp = data?.totp?.[0] as { last_challenged_at?: string } | undefined;

    if (!verifiedTotp) {
      setMfaRequired('MFA_ENROLLMENT_REQUIRED');
      return;
    }
    if (verifiedTotp.last_challenged_at) {
      const staleMs = Date.now() - new Date(verifiedTotp.last_challenged_at).getTime();
      if (staleMs > MFA_REVERIFY_INTERVAL_MS) {
        setMfaRequired('MFA_REVERIFY_REQUIRED');
        return;
      }
    }
    setMfaRequired(null);
  }, []);

  const resolveRoles = React.useCallback(async (userId: string) => {
    const [{ data: userRow }, { data: storeRoleRows }, { data: clientRoleRows }, { data: prefsRow }] = await Promise.all([
      supabase.from('users').select('is_portal_admin, is_super_admin').eq('id', userId).maybeSingle(),
      supabase.from('user_store_roles').select('store_id, role').eq('user_id', userId),
      supabase.from('user_client_roles').select('client_id, role').eq('user_id', userId),
      supabase.from('user_preferences').select('image_size').eq('user_id', userId).maybeSingle(),
    ]);

    if (prefsRow?.image_size) setImageSizePreferenceState(prefsRow.image_size as 'hide' | 'small' | 'large');

    const admin = userRow?.is_portal_admin === true;
    const superAdmin = userRow?.is_super_admin === true;
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
    setIsSuperAdmin(superAdmin);
    setStoreRoles(stores);
    setClientRoles(clients);
    setAccessibleStoreIds(accessible);

    // Staff aren't scoped to one company -- shown as "Shonrei staff" in
    // AppShell instead. For everyone else, resolve via a direct
    // client_admin role and/or through whichever client owns their
    // store(s) -- normally exactly one company, but joined rather than
    // just taking the first in case a test/edge-case account ever spans
    // more than one.
    if (!admin) {
      const clientIds = new Set(clients.map((c) => c.client_id));
      if (stores.length > 0) {
        const { data: storeClients } = await supabase
          .from('stores')
          .select('client_id')
          .in('id', stores.map((s) => s.store_id));
        for (const s of storeClients ?? []) clientIds.add(s.client_id as string);
      }
      if (clientIds.size > 0) {
        const { data: clientRows } = await supabase.from('clients').select('name').in('id', Array.from(clientIds));
        const names = (clientRows ?? []).map((c) => c.name as string);
        setCompanyName(names.length > 0 ? names.join(' / ') : null);
      } else {
        setCompanyName(null);
      }
    } else {
      setCompanyName(null);
    }

    if (admin) {
      await checkMfaStatus();
    } else {
      setMfaRequired(null);
    }
  }, [checkMfaStatus]);

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
        setIsSuperAdmin(false);
        setStoreRoles([]);
        setClientRoles([]);
        setAccessibleStoreIds(new Set());
        setMfaRequired(null);
        setCompanyName(null);
        setImageSizePreferenceState('small');
        setLoading(false);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [resolveRoles]);

  // Bridges api.ts's fetch layer (no React context access) back into
  // this context -- see lib/mfaSignal.ts.
  React.useEffect(() => {
    setMfaRequiredHandler((code) => setMfaRequired(code));
    return () => setMfaRequiredHandler(null);
  }, []);

  const refreshMfaStatus = React.useCallback(async () => {
    await checkMfaStatus();
  }, [checkMfaStatus]);

  // Optimistic: updates immediately so the toggle feels instant, then
  // persists in the background. Best-effort -- if the upsert fails the
  // user just won't have it remembered next login, not worth surfacing
  // an error for.
  const setImageSizePreference = React.useCallback(
    (v: 'hide' | 'small' | 'large') => {
      setImageSizePreferenceState(v);
      const userId = session?.user.id;
      if (!userId) return;
      supabase
        .from('user_preferences')
        .upsert({ user_id: userId, image_size: v, updated_at: new Date().toISOString() })
        .then(({ error }) => {
          if (error) console.error('Failed to save image size preference:', error.message);
        });
    },
    [session]
  );

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
    isSuperAdmin,
    storeRoles,
    clientRoles,
    accessibleStoreIds,
    companyName,
    canApprove,
    signOut,
    refreshRoles,
    mfaRequired,
    refreshMfaStatus,
    imageSizePreference,
    setImageSizePreference,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
