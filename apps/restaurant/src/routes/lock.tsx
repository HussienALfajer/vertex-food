import { createFileRoute } from '@tanstack/react-router';

// The session gate draws the lock screen itself, from the PC's status (features/session/).
export const Route = createFileRoute('/lock')({
  component: () => null,
});
