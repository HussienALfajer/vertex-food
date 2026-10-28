import { createFileRoute } from '@tanstack/react-router';
import { WhatsAppScreen } from '../../features/whatsapp/whatsapp-screen';

export const Route = createFileRoute('/whatsapp/')({
  component: WhatsAppScreen,
});
