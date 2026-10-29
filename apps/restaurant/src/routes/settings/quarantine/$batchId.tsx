import { createFileRoute } from '@tanstack/react-router';
import { QuarantineBatchScreen } from '../../../features/sync/quarantine-screen';

export const Route = createFileRoute('/settings/quarantine/$batchId')({
  component: function QuarantineBatchRoute() {
    const { batchId } = Route.useParams();
    return <QuarantineBatchScreen batchId={batchId} />;
  },
});
