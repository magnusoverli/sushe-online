/**
 * App - Root component rendered by the router.
 * Provides the global app shell and viewport setup.
 */

import { Outlet } from '@tanstack/react-router';
import { useViewport } from './hooks/useViewport';
import { useAuth } from './hooks/useAuth';
import { useRealtimeSync } from './hooks/useRealtimeSync';
import { ToastContainer } from './components/ui/Toast';
export function App() {
  // Set dynamic --vh for mobile browser chrome
  useViewport();

  // Sync auth session into Zustand store so all components
  // (e.g. settings tabs) can access the user object
  useAuth();

  // Connect Socket.IO for realtime list sync (only when authenticated)
  useRealtimeSync();

  return (
    <>
      <Outlet />
      <ToastContainer />
    </>
  );
}
