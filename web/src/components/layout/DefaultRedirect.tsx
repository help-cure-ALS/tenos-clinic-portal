import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';

export function DefaultRedirect() {
  const { userRole } = useAuthStore();
  const target = userRole === 'hca-admin' ? '/clinics' : '/dashboard';
  return <Navigate to={target} replace />;
}
