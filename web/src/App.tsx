import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShellLayout } from './components/layout/AppShell';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { VerificationsPage } from './pages/verifications/VerificationsPage';
import { TokensPage } from './pages/verifications/TokensPage';
import { ClinicsPage } from './pages/clinics/ClinicsPage';
import { ClinicDetailPage } from './pages/clinics/ClinicDetailPage';
import { StudiesPage } from './pages/studies/StudiesPage';
import { UsersPage } from './pages/users/UsersPage';
import { ClinicProfilePage } from './pages/clinic-profile/ClinicProfilePage';
import { ClinicStudiesPage } from './pages/clinic-studies/ClinicStudiesPage';
import { PractitionersPage } from './pages/practitioners/PractitionersPage';
import { InviteRedeemPage } from './pages/invite/InviteRedeemPage';
import { DefaultRedirect } from './components/layout/DefaultRedirect';
import { SuppliersPage } from './pages/suppliers/SuppliersPage';
import { SupplierDetailPage } from './pages/suppliers/SupplierDetailPage';
import { SupplierWorkflowPoliciesPage } from './pages/suppliers/SupplierWorkflowPoliciesPage';
import { StudiesSyncPage } from './pages/admin/StudiesSyncPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/app">
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register/:token" element={<InviteRedeemPage />} />

          {/* Protected routes inside AppShell */}
          <Route element={<AppShellLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />

            <Route path="/verifications" element={
              <ProtectedRoute allowedRoles={['hca-admin', 'clinic-admin', 'clinic-verifier']}>
                <VerificationsPage />
              </ProtectedRoute>
            } />

            <Route path="/tokens" element={
              <ProtectedRoute allowedRoles={['hca-admin', 'clinic-admin', 'clinic-verifier', 'clinic-member']}>
                <TokensPage />
              </ProtectedRoute>
            } />

            <Route path="/clinics" element={
              <ProtectedRoute allowedRoles={['hca-admin']}>
                <ClinicsPage />
              </ProtectedRoute>
            } />

            <Route path="/clinics/:clinicId" element={
              <ProtectedRoute allowedRoles={['hca-admin']}>
                <ClinicDetailPage />
              </ProtectedRoute>
            } />

            <Route path="/practitioners" element={
              <ProtectedRoute allowedRoles={['hca-admin']}>
                <PractitionersPage />
              </ProtectedRoute>
            } />

            <Route path="/studies" element={
              <ProtectedRoute allowedRoles={['hca-admin']}>
                <StudiesPage />
              </ProtectedRoute>
            } />

            <Route path="/studies-sync" element={
              <ProtectedRoute allowedRoles={['hca-admin']}>
                <StudiesSyncPage />
              </ProtectedRoute>
            } />

            <Route path="/suppliers" element={
              <ProtectedRoute allowedRoles={['hca-admin']}>
                <SuppliersPage />
              </ProtectedRoute>
            } />

            <Route path="/suppliers/:supplierId" element={
              <ProtectedRoute allowedRoles={['hca-admin']}>
                <SupplierDetailPage />
              </ProtectedRoute>
            } />

            <Route path="/supplier-workflow-policies" element={
              <ProtectedRoute allowedRoles={['hca-admin']}>
                <SupplierWorkflowPoliciesPage />
              </ProtectedRoute>
            } />

            <Route path="/users" element={
              <ProtectedRoute allowedRoles={['clinic-admin']}>
                <UsersPage />
              </ProtectedRoute>
            } />

            <Route path="/clinic-studies" element={
              <ProtectedRoute allowedRoles={['clinic-admin']}>
                <ClinicStudiesPage />
              </ProtectedRoute>
            } />

            <Route path="/clinic-profile" element={
              <ProtectedRoute allowedRoles={['clinic-admin']}>
                <ClinicProfilePage />
              </ProtectedRoute>
            } />
          </Route>

          <Route path="*" element={<DefaultRedirect />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
