import { createRootRoute } from '@tanstack/react-router';
import { AppShell } from '../components/app-shell';
import { ErrorState } from '../components/error-state';
import { NotFoundState } from '../components/not-found-state';
import { SessionGate } from '../features/session/session-gate';

export const Route = createRootRoute({
  // The session gate chooses the shell: the entry and lock screens bare, the app with its sidebar.
  component: SessionGate,
  errorComponent: ({ reset }) => (
    <AppShell>
      <ErrorState onRetry={reset} />
    </AppShell>
  ),
  notFoundComponent: NotFoundState,
});
