import { createFileRoute } from '@tanstack/react-router';
import { AttentionScreen } from '../features/sync/attention-screen';

export const Route = createFileRoute('/attention')({ component: AttentionScreen });
