import { createRootRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from '../components/app-shell';
import { ErrorState } from '../components/error-state';
import { NotFoundState } from '../components/not-found-state';
import { SessionGate } from '../features/session/session-gate';

export const Route = createRootRoute({
  component: () => (
    <SessionGate>
      <Outlet />
    </SessionGate>
  ),
  errorComponent: ({ reset }) => (
    <AppShell>
      <ErrorState onRetry={reset} />
    </AppShell>
  ),
  notFoundComponent: NotFoundState,
});
