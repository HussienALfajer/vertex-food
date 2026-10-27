import { createFileRoute } from '@tanstack/react-router';
import { StaffScreen } from '../../../features/staff/staff-screen';

export const Route = createFileRoute('/settings/staff/')({ component: StaffScreen });
