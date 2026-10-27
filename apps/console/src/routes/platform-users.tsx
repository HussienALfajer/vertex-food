import { createFileRoute } from '@tanstack/react-router';
import { PlatformUsersScreen } from '../features/platform-users/platform-users-screen';

export const Route = createFileRoute('/platform-users')({
  component: PlatformUsersScreen,
});
