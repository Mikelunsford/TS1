import { Navigate } from 'react-router-dom';

/** `/crm` -> `/crm/customers`. */
export default function CrmIndexRedirect() {
  return <Navigate to="/crm/customers" replace />;
}
