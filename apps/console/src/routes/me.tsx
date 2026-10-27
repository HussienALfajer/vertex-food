import { createFileRoute } from '@tanstack/react-router';
import { AccountScreen } from '../features/account/account-screen';

export const Route = createFileRoute('/me')({
  component: AccountScreen,
});
