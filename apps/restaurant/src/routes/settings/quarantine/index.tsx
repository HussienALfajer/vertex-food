import { createFileRoute } from '@tanstack/react-router';
import { QuarantineScreen } from '../../../features/sync/quarantine-screen';

export const Route = createFileRoute('/settings/quarantine/')({ component: QuarantineScreen });
