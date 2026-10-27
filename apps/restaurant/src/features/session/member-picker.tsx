import { Badge, Button } from '@vertex-food/ui';
import { UserRoundIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, type ApiErrorCode } from '../../lib/api';
import type { BridgeResult, DeviceMemberView } from '../../lib/device';
import { useErrorText } from '../../lib/error-text';

/** The Arabic text of a refusal from the main process, by its code like the API's. */
export function useBridgeErrorText(): (result: BridgeResult) => string | null {
  const errorText = useErrorText();
  return (result) => (result.ok ? null : errorText(new ApiError(result.code as ApiErrorCode)));
}

/** A member's roles as small badges. */
export function MemberRoles({ member }: { member: DeviceMemberView }) {
  const { t } = useTranslation('restaurant');
  return (
    <span className="flex flex-wrap gap-1">
      {member.roles.map((role) => (
        <Badge key={role}>{t(`roles.${role}`)}</Badge>
      ))}
    </span>
  );
}

/**
 * The branch's members as large buttons (rule 23): the member taps their name, never searches by
 * PIN. `note` explains why a member cannot be chosen.
 */
export function MemberPicker({
  label,
  members,
  onSelect,
  note,
}: {
  label: string;
  members: readonly DeviceMemberView[];
  onSelect: (member: DeviceMemberView) => void;
  note?: (member: DeviceMemberView) => ReactNode;
}) {
  return (
    <ul aria-label={label} className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {members.map((member) => {
        const why = note?.(member);
        return (
          <li key={member.membershipId}>
            <Button
              type="button"
              variant="secondary"
              className="h-auto min-h-16 w-full flex-col items-start gap-1 py-3 text-start lg:pointer-fine:h-auto"
              onClick={() => onSelect(member)}
            >
              <span className="flex items-center gap-2 text-base font-semibold">
                <UserRoundIcon aria-hidden />
                {member.name}
              </span>
              <MemberRoles member={member} />
              {why && <span className="text-sm font-normal text-muted-foreground">{why}</span>}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
