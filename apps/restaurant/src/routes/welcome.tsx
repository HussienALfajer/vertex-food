import { createFileRoute } from '@tanstack/react-router';
import { WelcomeScreen } from '../features/sign-in/entry-screens';

export const Route = createFileRoute('/welcome')({
  component: WelcomeScreen,
});
