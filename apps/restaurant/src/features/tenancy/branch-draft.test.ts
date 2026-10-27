import type { Branch, BranchCharge } from '@vertex-food/contracts';
import { describe, expect, it } from 'vitest';
import {
  branchDraft,
  chargeLines,
  chargesChanged,
  copyDayToAll,
  currencyUpdate,
  dayErrors,
  exceptionDraft,
  exceptionErrors,
  exceptionInput,
  hoursDraft,
  hoursErrors,
  hoursInput,
  locationDraft,
  locationErrors,
  locationUpdate,
  moneyDraft,
  moneyErrors,
  newCharge,
  normalizeTime,
  parseRate,
  reconcileDrafts,
  updateErrors,
} from './branch-draft';

const branch: Branch = {
  id: '0199f000-0000-7000-8000-000000000001',
  nameAr: 'الفرع الرئيسي',
  nameLatin: null,
  code: 'main',
  cityId: null,
  addressDescription: null,
  location: null,
  contactPhones: [],
  defaultCurrency: 'USD',
  acceptedCurrencies: ['USD'],
  currencyLockedAt: null,
  businessDayEndsAt: '04:00',
  idleLockMinutes: 5,
  createdAt: '2026-10-19T09:00:00.000Z',
  updatedAt: '2026-10-19T09:00:00.000Z',
  archivedAt: null,
};

const cityId = '0199f000-0000-7000-8000-0000000000aa';

describe('location draft', () => {
  it('starts a new branch with one empty phone row and asks for every completion item', () => {
    const draft = locationDraft(branch);
    expect(draft.phones).toEqual([{ phone: '', whatsapp: false }]);
    expect(locationErrors(draft)).toEqual({
      cityId: 'cityRequired',
      addressDescription: 'addressRequired',
      location: 'locationRequired',
      phones: 'phoneRequired',
    });
  });

  it('refuses a phone that is not Syrian or Turkish, and the same number twice', () => {
    const draft = {
      ...locationDraft(branch),
      phones: [
        { phone: '0900 000 001', whatsapp: true },
        { phone: '+963900000001', whatsapp: false },
        { phone: '12345', whatsapp: false },
      ],
    };
    expect(locationErrors(draft)).toMatchObject({
      'phones.1': 'phoneDuplicate',
      'phones.2': 'phoneInvalid',
    });
  });

  it('sends only what changed, phones in E.164 and WhatsApp on mobiles only', () => {
    const draft = {
      cityId,
      addressDescription: '  شارع السوق، قرب الجامع  ',
      location: { latitudeE7: 365_866_000, longitudeE7: 370_469_000 },
      phones: [
        { phone: '0900 000 001', whatsapp: true },
        { phone: '021 000 0001', whatsapp: true },
        { phone: '', whatsapp: false },
      ],
    };
    expect(locationErrors(draft)).toEqual({});
    expect(locationUpdate(draft, branch)).toEqual({
      updatedAt: branch.updatedAt,
      cityId,
      addressDescription: 'شارع السوق، قرب الجامع',
      location: draft.location,
      contactPhones: [
        { phone: '+963900000001', whatsapp: true },
        { phone: '+963210000001', whatsapp: false },
      ],
    });
    const saved = { ...branch, ...locationUpdate(draft, branch) } as Branch;
    expect(locationUpdate(locationDraft(saved), saved)).toEqual({ updatedAt: saved.updatedAt });
  });

  it('checks a settings save by its update only: phones save on a branch without a pin (audit A05)', () => {
    // A manager changes the phones of a branch that has no city, address or pin yet.
    const draft = { ...locationDraft(branch), phones: [{ phone: '0900 000 001', whatsapp: true }] };
    const {
      cityId: _,
      addressDescription: __,
      location: ___,
      ...phonesOnly
    } = locationUpdate(draft, branch);
    expect(updateErrors(draft, phonesOnly)).toEqual({});
    const bad = { ...draft, phones: [{ phone: '12345', whatsapp: false }] };
    expect(updateErrors(bad, locationUpdate(bad, branch))).toEqual({ 'phones.0': 'phoneInvalid' });
    // The owner clearing a saved address is refused as the API would; a long one too.
    const withAddress = { ...branch, addressDescription: 'شارع السوق' };
    const cleared = { ...locationDraft(withAddress), addressDescription: ' ' };
    expect(updateErrors(cleared, locationUpdate(cleared, withAddress))).toMatchObject({
      addressDescription: 'addressRequired',
    });
    const long = { ...cleared, addressDescription: 'ش'.repeat(301) };
    expect(updateErrors(long, locationUpdate(long, withAddress))).toMatchObject({
      addressDescription: 'addressTooLong',
    });
  });
});

describe('hours draft', () => {
  it('lays the periods out Saturday first and sends them back by weekday', () => {
    const draft = hoursDraft('04:00', [
      { weekday: 7, opensAt: '13:00', closesAt: '01:00' },
      { weekday: 1, opensAt: '10:00', closesAt: '23:00' },
    ]);
    expect(draft.days[0]).toEqual([{ opensAt: '10:00', closesAt: '23:00' }]);
    expect(draft.days[6]).toEqual([{ opensAt: '13:00', closesAt: '01:00' }]);
    expect(hoursInput(draft, branch.updatedAt).periods).toEqual([
      { weekday: 1, opensAt: '10:00', closesAt: '23:00' },
      { weekday: 7, opensAt: '13:00', closesAt: '01:00' },
    ]);
  });

  it('copies one day to every day', () => {
    const draft = hoursDraft('04:00', [{ weekday: 1, opensAt: '10:00', closesAt: '23:00' }]);
    const copied = copyDayToAll(draft, 0);
    expect(copied.days.every((day) => day.length === 1 && day[0]?.opensAt === '10:00')).toBe(true);
  });

  it('points at the period that breaks rule 12', () => {
    expect(dayErrors([{ opensAt: '22:00', closesAt: '05:00' }], '04:00', 'd')).toEqual({
      'd.0': 'periodContainsDayEnd',
    });
    expect(dayErrors([{ opensAt: '18:00', closesAt: '02:00' }], '04:00', 'd')).toEqual({});
    expect(
      dayErrors(
        [
          { opensAt: '10:00', closesAt: '15:00' },
          { opensAt: '14:00', closesAt: '20:00' },
        ],
        '04:00',
        'd',
      ),
    ).toEqual({ 'd.1': 'periodsOverlap' });
    expect(dayErrors([{ opensAt: '10:00', closesAt: '10:00' }], '04:00', 'd')).toEqual({
      'd.0': 'periodEmpty',
    });
    expect(dayErrors([{ opensAt: '10:00', closesAt: '' }], '04:00', 'd')).toEqual({
      'd.0': 'periodIncomplete',
    });
  });

  it('reads a typed time as HH:MM', () => {
    expect(normalizeTime('9')).toBe('09:00');
    expect(normalizeTime('930')).toBe('09:30');
    expect(normalizeTime('21:30')).toBe('21:30');
    expect(normalizeTime('٠٩:٣٠')).toBe('09:30');
    expect(normalizeTime('25')).toBe('25');
    expect(normalizeTime('10:75')).toBe('10:75');
    expect(dayErrors([{ opensAt: '10:75', closesAt: '23:00' }], '04:00', 'd')).toEqual({
      'd.0': 'periodIncomplete',
    });
  });

  it('needs one opening period in the wizard only', () => {
    const closed = hoursDraft('04:00', []);
    expect(hoursErrors(closed, { requireOpen: true })).toEqual({ days: 'hoursRequired' });
    expect(hoursErrors(closed, { requireOpen: false })).toEqual({});
  });
});

describe('money draft', () => {
  it('reads a percent into basis points without floating point', () => {
    expect(parseRate('10')).toBe(1000);
    expect(parseRate('2.5')).toBe(250);
    expect(parseRate('٢٫٥')).toBe(250);
    expect(parseRate('0.01')).toBe(1);
    expect(parseRate('50')).toBe(5000);
    expect(parseRate('50.01')).toBeUndefined();
    expect(parseRate('0')).toBeUndefined();
    expect(parseRate('1.234')).toBeUndefined();
    expect(parseRate('abc')).toBeUndefined();
  });

  it('checks the charge lines and keeps the default among the accepted currencies', () => {
    const draft = {
      ...moneyDraft(branch, []),
      acceptedCurrencies: ['TRY' as const],
      charges: [{ ...newCharge(), nameAr: 'خ', rate: '60', orderTypes: [] }],
    };
    expect(moneyErrors(draft)).toEqual({
      acceptedCurrencies: 'defaultNotAccepted',
      'charges.0.nameAr': 'chargeNameAr',
      'charges.0.rate': 'chargeRate',
      'charges.0.orderTypes': 'chargeOrderTypes',
    });
  });

  it('sends currencies and lines only when they changed', () => {
    const saved: BranchCharge[] = [
      {
        id: '0199f000-0000-7000-8000-0000000000c1',
        kind: 'service',
        nameAr: 'خدمة',
        nameLatin: null,
        rateBp: 1000,
        mode: 'added',
        orderTypes: ['dine_in'],
        position: 1,
      },
    ];
    const draft = moneyDraft(branch, saved);
    expect(draft.charges[0]?.rate).toBe('10');
    expect(chargesChanged(draft, saved)).toBe(false);
    expect(currencyUpdate(draft, branch)).toEqual({ updatedAt: branch.updatedAt });

    const changed = {
      ...draft,
      acceptedCurrencies: ['USD' as const, 'TRY' as const],
      charges: [{ ...newCharge(), nameAr: 'ضريبة', rate: '2.5', kind: 'tax' as const }],
    };
    expect(currencyUpdate(changed, branch)).toEqual({
      updatedAt: branch.updatedAt,
      acceptedCurrencies: ['USD', 'TRY'],
    });
    expect(chargesChanged(changed, saved)).toBe(true);
    expect(chargeLines(changed)).toEqual([
      {
        kind: 'tax',
        nameAr: 'ضريبة',
        nameLatin: null,
        rateBp: 250,
        mode: 'added',
        orderTypes: ['dine_in', 'takeaway', 'delivery', 'pickup'],
      },
    ]);
  });
});

describe('exception draft (rule 13)', () => {
  it('is closed, or has one or two valid periods', () => {
    const closed = { ...exceptionDraft(), date: '2026-10-25' };
    expect(exceptionErrors(closed, '04:00')).toEqual({});
    expect(exceptionInput(closed)).toEqual({ closed: true, periods: [], note: null });

    const open = { ...closed, closed: false };
    expect(exceptionErrors(open, '04:00')).toEqual({ periods: 'exceptionPeriods' });
    const evening = { ...open, periods: [{ opensAt: '18:00', closesAt: '02:00' }], note: ' عيد ' };
    expect(exceptionErrors(evening, '04:00')).toEqual({});
    expect(exceptionInput(evening)).toEqual({
      closed: false,
      periods: [{ opensAt: '18:00', closesAt: '02:00' }],
      note: 'عيد',
    });
  });

  it('needs a date', () => {
    expect(exceptionErrors(exceptionDraft(), '04:00')).toEqual({ date: 'exceptionDate' });
  });
});

describe('drafts after the branches were read again (rule 16)', () => {
  const at = (minute: number) => `2026-10-19T10:${String(minute).padStart(2, '0')}:00.000Z`;
  const detail = (id: string, updatedAt: string) => ({
    branch: { ...branch, id, updatedAt },
    hours: [],
    exceptions: [],
    charges: [],
  });
  const a = detail('0199f000-0000-7000-8000-00000000000a', at(1));
  const b = detail('0199f000-0000-7000-8000-00000000000b', at(1));
  const typed = (base: typeof a) => {
    const draft = branchDraft(base);
    return { ...draft, money: { ...draft.money, charges: [{ ...newCharge(), rate: '20' }] } };
  };

  it('keeps the unsent draft of a branch the server still holds as saved', () => {
    const drafts = { [a.branch.id]: typed(a), [b.branch.id]: typed(b) };
    const changedA = detail(a.branch.id, at(2));
    const next = reconcileDrafts([a, b], drafts, [changedA, b]);
    expect(next[a.branch.id]).toEqual(branchDraft(changedA));
    expect(next[b.branch.id]).toBe(drafts[b.branch.id]);
  });

  it('adds a branch added meanwhile and drops an archived one', () => {
    const c = detail('0199f000-0000-7000-8000-00000000000c', at(3));
    const drafts = { [a.branch.id]: typed(a), [b.branch.id]: typed(b) };
    const next = reconcileDrafts([a, b], drafts, [a, c]);
    expect(Object.keys(next)).toEqual([a.branch.id, c.branch.id]);
    expect(next[a.branch.id]).toBe(drafts[a.branch.id]);
    expect(next[c.branch.id]).toEqual(branchDraft(c));
  });
});
