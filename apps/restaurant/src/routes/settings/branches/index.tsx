import { createFileRoute } from '@tanstack/react-router';
import { BranchesScreen } from '../../../features/settings/branches-screen';

export const Route = createFileRoute('/settings/branches/')({
  component: BranchesScreen,
});
