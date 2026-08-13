import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useCart } from '@/lib/CartContext';
import { cn } from '@/lib/utils';
import { LayoutGrid, ShoppingCart, ClipboardList, CheckSquare, Boxes, LogOut, Settings, ShieldCheck } from 'lucide-react';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-[var(--accent-muted)] text-[var(--accent)]' : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
  );

export function AppShell() {
  const { isPortalAdmin, isSuperAdmin, storeRoles, clientRoles, signOut, session } = useAuth();
  const { count } = useCart();

  const canApproveAnything = isPortalAdmin || clientRoles.length > 0 || storeRoles.some((r) => r.role === 'store_admin');
  const canManageAccount = isPortalAdmin || clientRoles.length > 0;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)] p-4">
        <div className="mb-6 px-2 text-base font-semibold">Shonrei ordering</div>

        <nav className="flex flex-1 flex-col gap-1">
          <NavLink to="/" end className={navLinkClass}>
            <LayoutGrid className="h-4 w-4" />
            Catalog
          </NavLink>
          <NavLink to="/cart" className={navLinkClass}>
            <ShoppingCart className="h-4 w-4" />
            Cart
            {count > 0 && <span className="ml-auto rounded-full bg-[var(--accent)] px-1.5 text-xs text-white">{count}</span>}
          </NavLink>
          <NavLink to="/orders" className={navLinkClass}>
            <ClipboardList className="h-4 w-4" />
            My orders
          </NavLink>
          {canApproveAnything && (
            <NavLink to="/approvals" className={navLinkClass}>
              <CheckSquare className="h-4 w-4" />
              Approvals
            </NavLink>
          )}
          {isPortalAdmin && (
            <NavLink to="/admin/products" className={navLinkClass}>
              <Boxes className="h-4 w-4" />
              Product curation
            </NavLink>
          )}
          {isSuperAdmin && (
            <NavLink to="/admin/staff" className={navLinkClass}>
              <ShieldCheck className="h-4 w-4" />
              Staff
            </NavLink>
          )}
        </nav>

        <div className="mt-4 border-t border-[var(--border)] pt-4">
          {canManageAccount && (
            <NavLink to="/account" className={navLinkClass}>
              <Settings className="h-4 w-4" />
              Account
            </NavLink>
          )}
          <p className="mt-2 truncate px-2 text-xs text-[var(--muted-foreground)]">{session?.user.email}</p>
          <button
            onClick={() => signOut()}
            className="mt-1 flex w-full items-center gap-2.5 rounded-[var(--radius)] px-2 py-2 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
