import { createFileRoute } from '@tanstack/react-router';
import { BranchHoursScreen } from '../../../../features/settings/branch-hours-screen';

export const Route = createFileRoute('/settings/branches/$branchId/hours')({
  component: function BranchHoursRoute() {
    const { branchId } = Route.useParams();
    return <BranchHoursScreen key={branchId} branchId={branchId} />;
  },
});
