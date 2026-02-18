/**
 * App - Root component rendered by the router.
 * Provides the global app shell and viewport setup.
 */

import { Outlet } from '@tanstack/react-router';
import { useViewport } from './hooks/useViewport';

export function App() {
  // Set dynamic --vh for mobile browser chrome
  useViewport();

  return <Outlet />;
}
