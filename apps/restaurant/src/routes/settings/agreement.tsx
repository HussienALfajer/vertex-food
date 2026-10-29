import { createFileRoute } from '@tanstack/react-router';
import { AgreementScreen } from '../../features/agreement/agreement-screen';

export const Route = createFileRoute('/settings/agreement')({ component: AgreementScreen });
