import { createFileRoute } from '@tanstack/react-router';
import { RegisterScreen } from '../features/sign-in/entry-screens';

export const Route = createFileRoute('/register')({
  component: RegisterScreen,
});
