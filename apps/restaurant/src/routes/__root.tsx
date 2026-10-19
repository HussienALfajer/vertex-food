import { createRootRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from '../components/app-shell';
import { ErrorState } from '../components/error-state';
import { NotFoundState } from '../components/not-found-state';
import { useRestaurantNavigation } from '../features/tenancy/restaurant-nav';
import { TenantGate } from '../features/tenancy/tenant-gate';

function RootLayout() {
  const navigation = useRestaurantNavigation();
  return (
    <AppShell navigation={navigation}>
      <TenantGate>
        <Outlet />
      </TenantGate>
    </AppShell>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: ({ reset }) => (
    <AppShell>
      <ErrorState onRetry={reset} />
    </AppShell>
  ),
  notFoundComponent: NotFoundState,
});
