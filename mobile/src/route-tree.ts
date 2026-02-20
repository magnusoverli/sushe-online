/**
 * Route tree definition for TanStack Router.
 */

import {
  createRootRouteWithContext,
  createRoute,
  redirect,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { App } from './app';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { LibraryPage } from './pages/LibraryPage';
import { SearchPage } from './pages/SearchPage';
import { checkSession } from './services/auth';

interface RouterContext {
  queryClient: QueryClient;
}

// Root route
const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: App,
});

// Public routes
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterPage,
});

// Auth guard helper
async function requireAuth({ context }: { context: RouterContext }) {
  try {
    const session = await context.queryClient.ensureQueryData({
      queryKey: ['auth', 'session'],
      queryFn: checkSession,
      staleTime: 5 * 60 * 1000,
    });
    if (!session.authenticated) {
      throw redirect({ to: '/login' });
    }
  } catch (e) {
    if (e instanceof Error && e.message !== 'redirect') {
      throw redirect({ to: '/login' });
    }
    throw e;
  }
}

// Protected routes
const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LibraryPage,
  beforeLoad: requireAuth,
});

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  component: SearchPage,
  beforeLoad: requireAuth,
});

export const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  libraryRoute,
  searchRoute,
]);
