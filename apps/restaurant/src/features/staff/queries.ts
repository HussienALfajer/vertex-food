import { queryOptions } from '@tanstack/react-query';
import {
  type AccessCatalog,
  type AddStaffMember,
  type ChangeStaffAccess,
  type Device,
  type MembershipStatus,
  PAGE_SIZE_MAX,
  type PersonalDevice,
  type RevokeDevice,
  type StaffMember,
} from '@vertex-food/contracts';
import { api, body, unwrap, unwrapEmpty } from '../../lib/api';

// Server state of staff, devices and the member's own account (spec S02), online only: nothing
// here is queued while offline, and every write is a sensitive action run through `useSensitive`.

/** What the staff screens show and allow the caller: the catalog, presets, assignable roles. */
export const catalogQuery = queryOptions({
  queryKey: ['access', 'catalog'],
  queryFn: (): Promise<AccessCatalog> => unwrap(api.GET('/api/access/catalog')),
  staleTime: Number.POSITIVE_INFINITY,
});

export type StaffFilters = {
  status?: MembershipStatus | undefined;
  branchId?: string | undefined;
  page: number;
};

export function staffQuery(filters: StaffFilters) {
  return queryOptions({
    queryKey: ['staff', 'list', filters],
    queryFn: () =>
      unwrap(
        api.GET('/api/staff', {
          params: {
            query: body({
              status: filters.status,
              branchId: filters.branchId,
              page: filters.page,
              pageSize: PAGE_SIZE_MAX,
              sort: 'displayName' as const,
              order: 'asc' as const,
            }),
          },
        }),
      ),
  });
}

export function memberQuery(id: string) {
  return queryOptions({
    queryKey: ['staff', 'one', id],
    queryFn: (): Promise<StaffMember> =>
      unwrap(api.GET('/api/staff/{id}', { params: { path: { id } } })),
  });
}

export function addMember(input: AddStaffMember): Promise<StaffMember> {
  return unwrap(api.POST('/api/staff', { body: input }));
}

export function changeAccess(id: string, input: ChangeStaffAccess): Promise<StaffMember> {
  return unwrap(api.PATCH('/api/staff/{id}/access', { params: { path: { id } }, body: input }));
}

export function deactivateMember(id: string, reason: string): Promise<StaffMember> {
  return unwrap(
    api.POST('/api/staff/{id}/deactivate', { params: { path: { id } }, body: { reason } }),
  );
}

export function reactivateMember(id: string): Promise<StaffMember> {
  return unwrap(api.POST('/api/staff/{id}/reactivate', { params: { path: { id } } }));
}

/** Rule 22: the member types their new PIN on this PC while the manager's session is open. */
export function setMemberPin(id: string, pin: string): Promise<void> {
  return unwrapEmpty(api.PUT('/api/staff/{id}/pin', { params: { path: { id } }, body: { pin } }));
}

export function authorizePasswordReset(id: string): Promise<void> {
  return unwrapEmpty(api.POST('/api/staff/{id}/password-reset', { params: { path: { id } } }));
}

/** The registered PCs of the branches in the caller's scope. */
export const devicesQuery = queryOptions({
  queryKey: ['devices'],
  queryFn: (): Promise<Device[]> => unwrap(api.GET('/api/devices')),
});

export function renameDevice(id: string, name: string): Promise<Device> {
  return unwrap(api.PATCH('/api/devices/{id}', { params: { path: { id } }, body: { name } }));
}

export function revokeDevice(id: string, input: RevokeDevice): Promise<Device> {
  return unwrap(
    api.POST('/api/devices/{id}/revoke', { params: { path: { id } }, body: body(input) }),
  );
}

/** The person's personal devices (rule 35); reading them needs the password re-entry too. */
export function readPersonalDevices(): Promise<PersonalDevice[]> {
  return unwrap(api.GET('/api/me/personal-devices'));
}

export function revokePersonalDevice(id: string): Promise<PersonalDevice[]> {
  return unwrap(api.POST('/api/me/personal-devices/{id}/revoke', { params: { path: { id } } }));
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return unwrapEmpty(api.PUT('/api/me/password', { body: { currentPassword, newPassword } }));
}

/** Rule 22: the member's own PIN on this PC, with the current one. */
export function changeOwnPin(currentPin: string, newPin: string): Promise<void> {
  return unwrapEmpty(api.PUT('/api/me/pin', { body: { currentPin, newPin } }));
}
