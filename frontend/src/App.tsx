import { Routes, Route } from 'react-router-dom';
import { ProtectedRoute, StaffOnlyRoute, SuperAdminOnlyRoute } from '@/components/ProtectedRoute';
import { AppShell } from '@/components/AppShell';
import Login from '@/pages/Login';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import Catalog from '@/pages/Catalog';
import Cart from '@/pages/Cart';
import Orders from '@/pages/Orders';
import OrderDetail from '@/pages/OrderDetail';
import Approvals from '@/pages/Approvals';
import Account from '@/pages/Account';
import ProductCuration from '@/pages/admin/ProductCuration';
import Staff from '@/pages/admin/Staff';
import DevSession from '@/pages/DevSession';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {import.meta.env.DEV && <Route path="/dev-session" element={<DevSession />} />}

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Catalog />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:orderId" element={<OrderDetail />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/account" element={<Account />} />

          <Route element={<StaffOnlyRoute />}>
            <Route path="/admin/products" element={<ProductCuration />} />
          </Route>

          <Route element={<SuperAdminOnlyRoute />}>
            <Route path="/admin/staff" element={<Staff />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
