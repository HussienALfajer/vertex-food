import { createFileRoute } from '@tanstack/react-router';
import { BranchNetworkScreen } from '../../features/sync/branch-network-screen';

export const Route = createFileRoute('/settings/branch-network')({
  component: BranchNetworkScreen,
});
