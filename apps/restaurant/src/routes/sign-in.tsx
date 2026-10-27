import { createFileRoute } from '@tanstack/react-router';
import { SignInScreen } from '../features/sign-in/entry-screens';

export const Route = createFileRoute('/sign-in')({
  component: SignInScreen,
});
