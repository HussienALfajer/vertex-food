import { createFileRoute } from '@tanstack/react-router';
import { SignInScreen } from '../features/session/sign-in-screen';

type SignInSearch = { ended?: true };

export const Route = createFileRoute('/sign-in')({
  // `ended`: a session was running and ended (idle, expired, or ended elsewhere).
  validateSearch: (search: Record<string, unknown>): SignInSearch =>
    search.ended === true ? { ended: true } : {},
  component: function SignInRoute() {
    const { ended } = Route.useSearch();
    return <SignInScreen ended={ended === true} />;
  },
});
