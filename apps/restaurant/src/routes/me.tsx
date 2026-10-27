import { createFileRoute } from '@tanstack/react-router';
import { MyAccountScreen } from '../features/account/my-account-screen';

export const Route = createFileRoute('/me')({ component: MyAccountScreen });
