import React, { Suspense, lazy } from 'react';
import LivePage from './pages/LivePage.jsx';
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
export default function App() {
  const admin = window.location.pathname.replace(/\/$/, '') === '/admin';
  return admin ? <Suspense fallback={<main className="app-loading"><span className="spinner" /> Opening Signal Studio…</main>}><AdminPage /></Suspense> : <LivePage />;
}
