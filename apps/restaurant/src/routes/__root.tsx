import { createRootRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from '../components/app-shell';
import { ErrorState } from '../components/error-state';
import { NotFoundState } from '../components/not-found-state';

export const Route = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
  errorComponent: ({ reset }) => (
    <AppShell>
      <ErrorState onRetry={reset} />
    </AppShell>
  ),
  notFoundComponent: NotFoundState,
});
