import {
  type AccessCatalog,
  type Branch,
  type PermissionGroup,
  type StaffPermission,
  staffRoles,
} from '@vertex-food/contracts';
import { Badge, Checkbox } from '@vertex-food/ui';
import { useTranslation } from 'react-i18next';
import { FieldGroup } from '../../components/field-group';
import {
  type AccessDraft,
  type AccessErrors,
  heldPermissions,
  lockedReason,
  permissionSource,
  withBranch,
  withPermission,
  withRole,
} from './access-draft';

const sourceTone = {
  role: 'neutral',
  added: 'success',
  removed: 'warning',
  none: 'neutral',
} as const;

/**
 * Roles, branch scope and (owners only) permissions of a member (spec S02 screen 10): only the
 * roles the caller may assign and, for managers, only their branches (rule 7); each permission
 * says where it comes from, and those the roles' limits do not allow are disabled and explained.
 */
export function AccessFields({
  draft,
  onChange,
  catalog,
  branches,
  callerBranchIds,
  errors,
  disabled,
}: {
  draft: AccessDraft;
  onChange: (next: AccessDraft) => void;
  catalog: AccessCatalog;
  branches: readonly Branch[];
  /** The caller's own branches, or null for the whole tenant. */
  callerBranchIds: readonly string[] | null;
  errors: AccessErrors;
  disabled: boolean;
}) {
  const { t } = useTranslation('restaurant');
  const owner = draft.roles.includes('owner');
  const offered = branches.filter(
    (branch) => callerBranchIds === null || callerBranchIds.includes(branch.id),
  );
  // A role already held stays visible, so a manager sees what they may not change.
  const roles = staffRoles.filter(
    (role) => catalog.assignableRoles.includes(role) || draft.roles.includes(role),
  );

  return (
    <>
      <FieldGroup
        legend={t('staff.fields.roles')}
        error={errors.roles ? t('staff.fields.rolesRequired') : undefined}
        disabled={disabled}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {roles.map((role) => (
            // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's checkbox renders the control inside the label.
            <label key={role} className="flex min-h-11 items-center gap-2">
              <Checkbox
                checked={draft.roles.includes(role)}
                disabled={disabled || !catalog.assignableRoles.includes(role)}
                onCheckedChange={(checked) => onChange(withRole(draft, role, checked))}
              />
              {t(`roles.${role}`)}
            </label>
          ))}
        </div>
      </FieldGroup>

      {branches.length > 1 && (
        <FieldGroup
          legend={t('staff.fields.branches')}
          description={owner ? t('staff.fields.ownerBranches') : undefined}
          error={errors.branches ? t('staff.fields.branchesRequired') : undefined}
          disabled={disabled || owner}
        >
          {callerBranchIds === null && (
            // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's checkbox renders the control inside the label.
            <label className="flex min-h-11 items-center gap-2">
              <Checkbox
                checked={draft.allBranches}
                disabled={disabled || owner}
                onCheckedChange={(checked) =>
                  onChange({ ...draft, allBranches: checked, branchIds: [] })
                }
              />
              {t('staff.fields.allBranches')}
            </label>
          )}
          {!draft.allBranches && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {offered.map((branch) => (
                // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's checkbox renders the control inside the label.
                <label key={branch.id} className="flex min-h-11 items-center gap-2 wrap-anywhere">
                  <Checkbox
                    checked={draft.branchIds.includes(branch.id)}
                    disabled={disabled}
                    onCheckedChange={(checked) => onChange(withBranch(draft, branch.id, checked))}
                  />
                  {branch.nameAr}
                </label>
              ))}
            </div>
          )}
        </FieldGroup>
      )}

      {catalog.mayAdjustPermissions && (
        <PermissionFields draft={draft} onChange={onChange} catalog={catalog} disabled={disabled} />
      )}
    </>
  );
}

const groups: PermissionGroup[] = ['tenant', 'branch', 'staff', 'devices'];

function PermissionFields({
  draft,
  onChange,
  catalog,
  disabled,
}: {
  draft: AccessDraft;
  onChange: (next: AccessDraft) => void;
  catalog: AccessCatalog;
  disabled: boolean;
}) {
  const { t } = useTranslation('restaurant');
  const held = new Set<StaffPermission>(heldPermissions(draft));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-foreground">{t('staff.permissions.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('staff.permissions.description')}</p>
      </div>
      {groups.map((group) => {
        const items = catalog.permissions.filter((item) => item.group === group);
        if (items.length === 0) return null;
        return (
          <FieldGroup
            key={group}
            legend={t(`staff.permissions.groups.${group}`)}
            disabled={disabled}
          >
            <ul className="flex flex-col gap-3">
              {items.map(({ key }) => {
                const locked = lockedReason(draft, key);
                const source = permissionSource(draft, key);
                return (
                  <li key={key} className="flex flex-col gap-1">
                    {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI's checkbox renders the control inside the label. */}
                    <label className="flex min-h-11 flex-wrap items-center gap-2">
                      <Checkbox
                        checked={held.has(key)}
                        disabled={disabled || locked !== null}
                        onCheckedChange={(checked) => onChange(withPermission(draft, key, checked))}
                      />
                      <span className="min-w-0 wrap-anywhere">{t(`permissions.${key}`)}</span>
                      {source !== 'none' && (
                        <Badge tone={sourceTone[source]}>
                          {t(`staff.permissions.source.${source}`)}
                        </Badge>
                      )}
                    </label>
                    {locked && (
                      <p className="ps-7 text-sm text-muted-foreground">
                        {t(`staff.permissions.locked.${locked}`)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </FieldGroup>
        );
      })}
    </div>
  );
}
