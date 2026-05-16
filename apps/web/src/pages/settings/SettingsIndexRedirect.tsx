import { Navigate } from 'react-router-dom';

/** `/settings` -> `/settings/company` (Phase 15 default). */
export default function SettingsIndexRedirect() {
  return <Navigate to="/settings/company" replace />;
}
