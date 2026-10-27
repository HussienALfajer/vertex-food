import { createFileRoute } from '@tanstack/react-router';
import { AddMemberScreen } from '../../../features/staff/add-member-screen';

export const Route = createFileRoute('/settings/staff/new')({ component: AddMemberScreen });
