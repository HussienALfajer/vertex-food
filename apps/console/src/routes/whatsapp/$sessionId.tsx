import { createFileRoute } from '@tanstack/react-router';
import { WhatsAppSessionScreen } from '../../features/whatsapp/whatsapp-session-screen';

export const Route = createFileRoute('/whatsapp/$sessionId')({
  component: function WhatsAppSessionRoute() {
    const { sessionId } = Route.useParams();
    return <WhatsAppSessionScreen key={sessionId} sessionId={sessionId} />;
  },
});
