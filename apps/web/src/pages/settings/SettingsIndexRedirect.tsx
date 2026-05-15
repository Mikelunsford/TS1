import { Navigate } from 'react-router-dom';

/** `/settings` -> `/settings/currencies`. */
export default function SettingsIndexRedirect() {
  return <Navigate to="/settings/currencies" replace />;
}
