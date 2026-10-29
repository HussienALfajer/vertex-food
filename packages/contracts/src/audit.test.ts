import { describe, expect, it } from 'vitest';
import {
  AUDIT_MAX_RANGE_DAYS,
  auditActionCatalog,
  auditActions,
  auditActionsOf,
  auditCategories,
  auditPeriod,
  auditQueryCategories,
  auditQuerySchema,
  decodeAuditCursor,
  encodeAuditCursor,
  localEventActions,
  platformAuditQuerySchema,
  shownAuditActorKind,
  shownAuditDetails,
} from './audit.js';
import { addDays } from './time.js';

const id = '0192f0a4-5c2e-7a3b-8c4d-5e6f7a8b9c0d';

describe('audit action catalog', () => {
  it('keeps every action from S01 to S05 in its order, then S06', () => {
    expect(auditActions[0]).toBe('tenant.created');
    expect(auditActions.indexOf('entitlements.overridden')).toBe(
      auditActions.indexOf('data_export.requested') - 1,
    );
    expect(new Set(auditActions).size).toBe(auditActions.length);
  });

  it('gives every action a log, a known category and named detail fields', () => {
    for (const action of auditActions) {
      const definition = auditActionCatalog[action];
      expect(['tenant', 'platform', 'both'], action).toContain(definition.log);
      expect(auditCategories, action).toContain(definition.category);
      for (const field of definition.detailFields) expect(field, action).toMatch(/^[a-zA-Z]+$/);
    }
  });

  it('writes the local events and the export to the tenant log, under their categories', () => {
    for (const action of localEventActions) {
      expect(auditActionCatalog[action].log).toBe('tenant');
    }
    expect(auditActions.filter((action) => auditActionCatalog[action].category === 'data')).toEqual(
      [
        'data_export.requested',
        'data_export.completed',
        'data_export.failed',
        'data_export.downloaded',
        'data_export.expired',
      ],
    );
  });

  it('lists the recoveries in both logs and nothing else', () => {
    const both = auditActions.filter((action) => auditActionCatalog[action].log === 'both');
    expect(both).toEqual(['account.password_reset_authorized', 'account.phone_changed']);
    expect(auditActionsOf('tenant')).toContain('account.phone_changed');
    expect(auditActionsOf('platform')).toContain('account.phone_changed');
    expect(auditActionsOf('tenant')).not.toContain('console.request');
    expect(auditActionsOf('platform')).not.toContain('branch.updated');
  });
});

describe('shownAuditDetails', () => {
  it('shows a field of before and after as a change', () => {
    expect(
      shownAuditDetails('branch_hours.replaced', {
        before: { businessDayEndsAt: '04:00', periods: [] },
        after: { businessDayEndsAt: '05:00', periods: [] },
      }),
    ).toEqual([
      { field: 'businessDayEndsAt', change: true, before: '04:00', after: '05:00' },
      { field: 'periods', change: true, before: [], after: [] },
    ]);
  });

  it('shows other fields as values, in catalog order, leaving out absent and unlisted ones', () => {
    expect(
      shownAuditDetails('tenant.status_changed', { to: 'suspended', from: 'active', note: 'x' }),
    ).toEqual([
      { field: 'from', change: false, value: 'active' },
      { field: 'to', change: false, value: 'suspended' },
    ]);
    expect(shownAuditDetails('tenant.onboarding_completed', { anything: 1 })).toEqual([]);
    expect(shownAuditDetails('branch.updated', null)).toEqual([]);
  });

  it('shows whole before and after lists as values (charge lines, a device name)', () => {
    expect(
      shownAuditDetails('branch_charges.replaced', { before: [], after: [{ kind: 'x' }] }),
    ).toEqual([
      { field: 'before', change: false, value: [] },
      { field: 'after', change: false, value: [{ kind: 'x' }] },
    ]);
    expect(shownAuditDetails('device.renamed', { before: 'A', after: 'B' })).toEqual([
      { field: 'before', change: false, value: 'A' },
      { field: 'after', change: false, value: 'B' },
    ]);
  });

  it('shows a field one side lacks, such as a new exception', () => {
    expect(
      shownAuditDetails('branch_hour_exception.created', { after: { date: '2026-11-01' } }),
    ).toEqual([{ field: 'date', change: true, before: undefined, after: '2026-11-01' }]);
  });
});

describe('shownAuditActorKind (rule 3)', () => {
  it('shows members, PCs, jobs and Vertex apart', () => {
    expect(shownAuditActorKind('staff', null)).toBe('staff');
    expect(shownAuditActorKind('platform', null)).toBe('vertex');
    expect(shownAuditActorKind('system', 'device')).toBe('device');
    expect(shownAuditActorKind('system', 'tenancy/apply-scheduled-status')).toBe('system');
    expect(shownAuditActorKind('system', 'data-export/build')).toBe('system');
    // A CLI operator is a Vertex person: never named to a restaurant.
    expect(shownAuditActorKind('system', 'Samer Haddad')).toBe('vertex');
    expect(shownAuditActorKind('system', null)).toBe('vertex');
  });
});

describe('audit queries (rules 2, 18)', () => {
  it('accepts a period up to 366 days and refuses longer or backwards ones', () => {
    const from = '2026-01-01';
    expect(
      auditQuerySchema.safeParse({ from, to: addDays(from, AUDIT_MAX_RANGE_DAYS - 1) }).success,
    ).toBe(true);
    expect(
      auditQuerySchema.safeParse({ from, to: addDays(from, AUDIT_MAX_RANGE_DAYS) }).success,
    ).toBe(false);
    expect(auditQuerySchema.safeParse({ from, to: '2025-12-31' }).success).toBe(false);
    expect(
      platformAuditQuerySchema.safeParse({ from, to: addDays(from, AUDIT_MAX_RANGE_DAYS) }).success,
    ).toBe(false);
  });

  it('reads one or several categories, and refuses a branch with tenant-wide', () => {
    const one = auditQuerySchema.parse({ category: 'access' });
    const many = auditQuerySchema.parse({ category: ['access', 'devices'] });
    expect(auditQueryCategories(one)).toEqual(['access']);
    expect(auditQueryCategories(many)).toEqual(['access', 'devices']);
    expect(auditQueryCategories(auditQuerySchema.parse({}))).toEqual([]);
    expect(auditQuerySchema.safeParse({ category: 'cooking' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ branchId: id, tenantWide: 'true' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ branchId: id, tenantWide: 'false' }).success).toBe(true);
  });

  it('defaults to the last 7 Damascus days, today included', () => {
    const now = new Date('2026-10-29T22:30:00.000Z'); // 01:30 on the 30th in Damascus
    expect(auditPeriod({}, now)).toEqual({
      from: new Date('2026-10-23T21:00:00.000Z'),
      to: new Date('2026-10-30T21:00:00.000Z'),
    });
    expect(auditPeriod({ from: '2026-10-01', to: '2026-10-01' }, now)).toEqual({
      from: new Date('2026-09-30T21:00:00.000Z'),
      to: new Date('2026-10-01T21:00:00.000Z'),
    });
    expect(auditPeriod({ from: '2026-10-01' }, now).to).toEqual(
      new Date('2026-10-07T21:00:00.000Z'),
    );
  });

  it('round-trips a cursor and refuses a malformed one', () => {
    const cursor = { occurredAt: new Date('2026-10-29T11:05:00.123Z'), id };
    const encoded = encodeAuditCursor(cursor);
    expect(auditQuerySchema.safeParse({ before: encoded }).success).toBe(true);
    expect(decodeAuditCursor(encoded)).toEqual(cursor);
    expect(auditQuerySchema.safeParse({ before: 'yesterday' }).success).toBe(false);
  });
});
