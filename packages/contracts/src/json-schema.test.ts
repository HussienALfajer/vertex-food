import { describe, expect, it } from 'vitest';
import { contractJsonSchemas, currencies } from './index.js';

// The contracts are usable from any client (a Flutter or native app, an OpenAPI document): every
// schema with an id converts to JSON Schema without loss, and the conversion keeps the rules.

describe('contractJsonSchemas', () => {
  const { schemas } = contractJsonSchemas();

  it('exports every contract schema by its id', () => {
    expect(Object.keys(schemas).sort()).toEqual(
      [
        'Coordinates',
        'CurrencyCode',
        'ErrorCode',
        'ErrorResponse',
        'ExchangeRate',
        'HealthCheck',
        'Id',
        'Instant',
        'Liveness',
        'Money',
        'SortOrder',
        // S01
        'ArchiveBranch',
        'AuditAction',
        'AuditActorKind',
        'Branch',
        'BranchCharge',
        'BranchChargeInput',
        'BranchChargeList',
        'BranchList',
        'BranchCode',
        'BranchDetail',
        'BranchHours',
        'BusinessDayEnd',
        'CancelScheduledTenantStatus',
        'ChangeTenantStatus',
        'ChargeKind',
        'ChargeMode',
        'City',
        'ConsolePermission',
        'ConsoleTenant',
        'ConsoleTenantDetail',
        'ConsoleTenantPage',
        'ContactPhone',
        'CreateBranch',
        'CreateCity',
        'CreateGovernorate',
        'CreateHourException',
        'CreateTenant',
        'File',
        'FileBytes',
        'FilePurpose',
        'NoContent',
        'Governorate',
        'GovernorateList',
        'HourException',
        'ListConsoleTenantsQuery',
        'LocalDate',
        'MissingOnboardingItem',
        'OnboardingCompleteness',
        'OnboardingItem',
        'OpeningPeriod',
        'OrderType',
        'PhoneNumber',
        'ReplaceBranchCharges',
        'ReplaceBranchHours',
        'ResolveMapLink',
        'ScheduledStatusChange',
        'ScheduledTenantStatus',
        'SetTenantSlug',
        'Slug',
        'StaffPermission',
        'Tenant',
        'TenantSlug',
        'TenantStatus',
        'TenantStatusReason',
        'TenantStatusRequest',
        'TimeOfDay',
        'UpdateBranch',
        'UpdateHourException',
        'UpdateTenant',
        'Weekday',
        'WeeklyPeriod',
      ].sort(),
    );
  });

  it('keeps money as an integer with a currency from the list', () => {
    expect(schemas.Money).toMatchObject({
      type: 'object',
      properties: {
        amount: { type: 'integer' },
        currency: { $ref: 'CurrencyCode' },
      },
      required: ['amount', 'currency'],
    });
    expect(schemas.CurrencyCode).toMatchObject({ type: 'string', enum: ['USD', 'TRY', 'SYP'] });
  });

  it('carries the exponent of every currency, as the money module uses it', () => {
    expect(schemas.CurrencyCode?.['x-exponents']).toEqual(
      Object.fromEntries(Object.entries(currencies).map(([code, c]) => [code, c.exponent])),
    );
  });

  it('keeps ids as UUIDv7 and instants as UTC date-times', () => {
    expect(schemas.Id).toMatchObject({ type: 'string', format: 'uuid' });
    expect(schemas.Id?.pattern).toMatch(/7/);
    expect(schemas.Instant).toMatchObject({ type: 'string', format: 'date-time' });
  });
});
