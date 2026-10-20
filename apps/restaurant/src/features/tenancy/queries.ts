import { queryOptions, useQueryClient } from '@tanstack/react-query';
import type {
  Branch,
  BranchCharges,
  BranchDetail,
  BranchHours,
  Coordinates,
  CreateHourException,
  FilePurpose,
  Governorate,
  HourException,
  ReplaceBranchCharges,
  ReplaceBranchHours,
  StoredFile,
  Tenant,
  UpdateBranch,
  UpdateHourException,
  UpdateTenant,
} from '@vertex-food/contracts';
import { ApiError, api, body, unwrap, unwrapEmpty } from '../../lib/api';
import { fetchNow } from '../../lib/query-client';

// Server state of restaurant setup (S01), online only: nothing here is queued while offline.

const readTenant = (): Promise<Tenant> => unwrap(api.GET('/api/tenant'));

export const tenantQuery = queryOptions({ queryKey: ['tenant'], queryFn: readTenant });

const readBranches = (): Promise<Branch[]> => unwrap(api.GET('/api/branches'));

/** The tenant's branches in use, with the member's branch scope applied by the API. */
export const branchesQuery = queryOptions({ queryKey: ['branches'], queryFn: readBranches });

function readBranch(id: string): Promise<BranchDetail> {
  return unwrap(api.GET('/api/branches/{id}', { params: { path: { id } } }));
}

/** A branch with its weekly hours, its exceptions from today on and its charge lines. */
export function branchQuery(id: string) {
  return queryOptions({ queryKey: ['branches', 'one', id], queryFn: () => readBranch(id) });
}

/** Governorates with their cities in use; they change only through Vertex staff. */
export const citiesQuery = queryOptions({
  queryKey: ['cities'],
  queryFn: (): Promise<Governorate[]> => unwrap(api.GET('/api/cities')),
  staleTime: Number.POSITIVE_INFINITY,
});

/**
 * A stored image as a `data:` URL: the request carries the session (S02) and the CSP allows
 * images from the app and `data:` only. A file never changes, so it is cached for good.
 */
export function imageQuery(fileId: string) {
  return queryOptions({
    queryKey: ['files', fileId],
    queryFn: async (): Promise<string> => {
      const blob = await unwrap(
        api.GET('/api/files/{id}', { params: { path: { id: fileId } }, parseAs: 'blob' }),
      );
      return dataUrl(blob as Blob);
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new ApiError('INTERNAL_ERROR'));
    reader.readAsDataURL(blob);
  });
}

export function updateTenant(input: UpdateTenant): Promise<Tenant> {
  return unwrap(api.PATCH('/api/tenant', { body: input }));
}

const imagePaths = { logo: '/api/tenant/logo', cover: '/api/tenant/cover' } as const;

export function replaceImage(purpose: FilePurpose, file: File): Promise<StoredFile> {
  return unwrap(
    api.PUT(imagePaths[purpose], {
      // The generated type names the multipart field; the browser sends the file itself.
      body: { file: '' },
      bodySerializer: () => {
        const form = new FormData();
        form.append('file', file);
        return form;
      },
    }),
  );
}

export function removeImage(purpose: FilePurpose): Promise<void> {
  return unwrapEmpty(api.DELETE(imagePaths[purpose]));
}

export function completeOnboarding(): Promise<Tenant> {
  return unwrap(api.POST('/api/tenant/onboarding/complete'));
}

export function updateBranch(id: string, input: UpdateBranch): Promise<Branch> {
  return unwrap(api.PATCH('/api/branches/{id}', { params: { path: { id } }, body: body(input) }));
}

export function replaceHours(id: string, input: ReplaceBranchHours): Promise<BranchHours> {
  return unwrap(api.PUT('/api/branches/{id}/hours', { params: { path: { id } }, body: input }));
}

/** The new lines with the branch's new `updatedAt`, the base of its next write (rule 16). */
export function replaceCharges(id: string, input: ReplaceBranchCharges): Promise<BranchCharges> {
  return unwrap(
    api.PUT('/api/branches/{id}/charges', {
      params: { path: { id } },
      body: { ...input, lines: input.lines.map(body) },
    }),
  );
}

export function createException(id: string, input: CreateHourException): Promise<HourException> {
  return unwrap(
    api.POST('/api/branches/{id}/hour-exceptions', { params: { path: { id } }, body: body(input) }),
  );
}

export function updateException(
  id: string,
  exceptionId: string,
  input: UpdateHourException,
): Promise<HourException> {
  return unwrap(
    api.PATCH('/api/branches/{id}/hour-exceptions/{exceptionId}', {
      params: { path: { id, exceptionId } },
      body: input,
    }),
  );
}

export function removeException(id: string, exceptionId: string): Promise<void> {
  return unwrapEmpty(
    api.DELETE('/api/branches/{id}/hour-exceptions/{exceptionId}', {
      params: { path: { id, exceptionId } },
    }),
  );
}

export function resolveMapLink(url: string): Promise<Coordinates> {
  return unwrap(api.POST('/api/maps/resolve-link', { body: { url } }));
}

/**
 * What a screen does around a write: answers replace the cached records; a refusal because the
 * restaurant was suspended or closed meanwhile reloads the tenant, so its banner shows; `reload*`
 * read the current record from the server now, after a `CONFLICT` (rule 16) or a write that
 * changed the record's `updatedAt` without returning it (images).
 */
export function useSetupCache() {
  const queryClient = useQueryClient();
  // A branch's fields decide the tenant's onboarding list (what is missing): re-read it.
  const completenessMoved = () =>
    void queryClient.invalidateQueries({ queryKey: tenantQuery.queryKey, exact: true });
  return {
    tenantSaved: (tenant: Tenant) => queryClient.setQueryData(tenantQuery.queryKey, tenant),
    branchSaved: (branch: Branch) => {
      completenessMoved();
      queryClient.setQueryData(branchQuery(branch.id).queryKey, (detail?: BranchDetail) =>
        detail ? { ...detail, branch } : detail,
      );
      queryClient.setQueryData(branchesQuery.queryKey, (list?: Branch[]) =>
        list?.map((item) => (item.id === branch.id ? branch : item)),
      );
    },
    detailSaved: (detail: BranchDetail) => {
      completenessMoved();
      queryClient.setQueryData(branchQuery(detail.branch.id).queryKey, detail);
      queryClient.setQueryData(branchesQuery.queryKey, (list?: Branch[]) =>
        list?.map((item) => (item.id === detail.branch.id ? detail.branch : item)),
      );
    },
    refused: (error: unknown) => {
      if (
        error instanceof ApiError &&
        (error.code === 'TENANT_SUSPENDED' || error.code === 'TENANT_CLOSED')
      ) {
        return queryClient.invalidateQueries({ queryKey: tenantQuery.queryKey, exact: true });
      }
    },
    reloadTenant: () => fetchNow(queryClient, tenantQuery.queryKey, readTenant),
    reloadBranches: () => fetchNow(queryClient, branchesQuery.queryKey, readBranches),
    /**
     * Every branch in use with its detail, the list read again (a branch added or archived
     * meanwhile). The details are cached before the list, so a screen built from the list never
     * meets a branch it has no detail for.
     */
    reloadBranchDetails: async () => {
      const list = await readBranches();
      const details = await Promise.all(
        list.map((branch) =>
          fetchNow(queryClient, branchQuery(branch.id).queryKey, () => readBranch(branch.id)),
        ),
      );
      queryClient.setQueryData(branchesQuery.queryKey, list);
      return details;
    },
    reloadBranch: (id: string) =>
      fetchNow(queryClient, branchQuery(id).queryKey, () => readBranch(id)),
  };
}
