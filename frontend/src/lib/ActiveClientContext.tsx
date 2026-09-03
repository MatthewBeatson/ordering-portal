import * as React from 'react';

const STORAGE_KEY = 'shonrei-portal:active-client-id';

interface ActiveClientContextValue {
  activeClientId: string | null;
  setActiveClientId: (clientId: string | null) => void;
}

const ActiveClientContext = React.createContext<ActiveClientContextValue | null>(null);

// Shared "which client is staff currently working with," so switching
// context on one screen (or in another browser tab) carries over
// everywhere instead of each screen/tab independently defaulting or
// going stale. Two-way between Catalog's store selection and client-
// scoped admin screens (Product Curation, and any future ones) --
// Catalog itself guards the store-changing direction with a confirm if
// it would clear an in-progress cart (see Catalog.tsx).
//
// Persisted to localStorage AND kept live across tabs via the
// `storage` event (fires in every OTHER tab when one tab writes this
// key -- never the tab that made the change, which already has the
// fresh value from its own setActiveClientId call). Purely a per-
// browser staff convenience, nothing sensitive.
export function ActiveClientProvider({ children }: { children: React.ReactNode }) {
  const [activeClientId, setActiveClientIdState] = React.useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const setActiveClientId = React.useCallback((clientId: string | null) => {
    setActiveClientIdState(clientId);
    try {
      if (clientId) localStorage.setItem(STORAGE_KEY, clientId);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage unavailable (e.g. private browsing) -- fine to
      // just not persist for this session.
    }
  }, []);

  React.useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setActiveClientIdState(e.newValue);
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const value = React.useMemo(() => ({ activeClientId, setActiveClientId }), [activeClientId, setActiveClientId]);

  return <ActiveClientContext.Provider value={value}>{children}</ActiveClientContext.Provider>;
}

export function useActiveClient() {
  const ctx = React.useContext(ActiveClientContext);
  if (!ctx) throw new Error('useActiveClient must be used within an ActiveClientProvider');
  return ctx;
}
