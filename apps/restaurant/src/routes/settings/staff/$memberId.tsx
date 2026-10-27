import { createFileRoute } from '@tanstack/react-router';
import { MemberScreen } from '../../../features/staff/member-screen';

export const Route = createFileRoute('/settings/staff/$memberId')({
  component: function MemberRoute() {
    const { memberId } = Route.useParams();
    return <MemberScreen key={memberId} memberId={memberId} />;
  },
});
