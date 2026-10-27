import { createFileRoute } from '@tanstack/react-router';
import { DevicesScreen } from '../../features/devices/devices-screen';

export const Route = createFileRoute('/settings/devices')({ component: DevicesScreen });
