import { createFileRoute } from '@tanstack/react-router';
import { BranchSettingsScreen } from '../../../../features/settings/branch-settings-screen';

export const Route = createFileRoute('/settings/branches/$branchId/')({
  component: function BranchSettingsRoute() {
    const { branchId } = Route.useParams();
    return <BranchSettingsScreen key={branchId} branchId={branchId} />;
  },
});
