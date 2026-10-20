import {
  type Branch,
  type BranchCharge,
  type BranchChargeInput,
  type BranchDetail,
  branchChargeInputSchema,
  type Coordinates,
  type CreateHourException,
  type CurrencyCode,
  DEFAULT_BUSINESS_DAY_END,
  DomainError,
  formatRateBp,
  type HourException,
  MAX_CHARGE_LINES,
  MAX_CONTACT_PHONES,
  MAX_PERIODS_PER_DAY,
  type OpeningPeriod,
  type OrderType,
  orderTypeSchema,
  parsePhoneNumber,
  periodNextDay,
  type ReplaceBranchHours,
  type TimeOfDay,
  type UpdateBranch,
  updateBranchSchema,
  validateDayPeriods,
  type Weekday,
  type WeeklyPeriod,
} from '@vertex-food/contracts';
import type { Catalog } from '@vertex-food/i18n';

type ChargeKind = BranchChargeInput['kind'];
type ChargeMode = BranchChargeInput['mode'];

// The drafts of a branch's settings (S01) and their checks, kept pure: the wizard and the settings
// screens share them. An error is a key of `restaurant:validation`, never a message.

/** The key of a check's text in `restaurant:validation`. */
export type ValidationKey = keyof Catalog['restaurant']['validation'];

export type FieldErrors = Partial<Record<string, ValidationKey>>;

/** The days of the Syrian week, Saturday first (1 = Saturday … 7 = Friday). */
export const weekdays = [1, 2, 3, 4, 5, 6, 7] as const satisfies readonly Weekday[];

/** The key of each weekday's name in `restaurant:weekdays`, Saturday first. */
export const weekdayKeys = [
  'saturday',
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
] as const;

export const weekdayKey = (weekday: Weekday) => weekdayKeys[weekday - 1] ?? 'saturday';

export const orderTypes = orderTypeSchema.options;

// Location: city, address, pin and phones (wizard step 2, branch settings).

export type PhoneDraft = { phone: string; whatsapp: boolean };

export type LocationDraft = {
  cityId: string | undefined;
  addressDescription: string;
  location: Coordinates | null;
  phones: PhoneDraft[];
};

export function locationDraft(branch: Branch): LocationDraft {
  return {
    cityId: branch.cityId ?? undefined,
    addressDescription: branch.addressDescription ?? '',
    location: branch.location,
    phones: branch.contactPhones.length
      ? branch.contactPhones.map((entry) => ({ ...entry }))
      : [{ phone: '', whatsapp: false }],
  };
}

/** The entries typed so far: a row left empty is no phone. */
function typedPhones(phones: readonly PhoneDraft[]): PhoneDraft[] {
  return phones.filter((entry) => entry.phone.trim() !== '');
}

export function phoneErrors(
  phones: readonly PhoneDraft[],
  { required = true }: { required?: boolean } = {},
): FieldErrors {
  const errors: FieldErrors = {};
  const seen = new Set<string>();
  phones.forEach((entry, index) => {
    if (entry.phone.trim() === '') return;
    const parsed = parsePhoneNumber(entry.phone);
    if (!parsed) errors[`phones.${index}`] = 'phoneInvalid';
    else if (seen.has(parsed.e164)) errors[`phones.${index}`] = 'phoneDuplicate';
    else seen.add(parsed.e164);
  });
  if (required && typedPhones(phones).length === 0) errors.phones = 'phoneRequired';
  return errors;
}

/** The address as the contract reads it, or the key of what is wrong with it. */
function addressError(address: string): ValidationKey | undefined {
  const result = updateBranchSchema.shape.addressDescription.safeParse(address);
  if (result.success) return undefined;
  return result.error.issues.some((issue) => issue.code === 'too_big')
    ? 'addressTooLong'
    : 'addressRequired';
}

/** The wizard's location step: everything onboarding needs (rule 3), in the contract's shapes. */
export function locationErrors(draft: LocationDraft): FieldErrors {
  const errors: FieldErrors = phoneErrors(draft.phones);
  if (!draft.cityId) errors.cityId = 'cityRequired';
  const address = addressError(draft.addressDescription);
  if (address) errors.addressDescription = address;
  if (!draft.location) errors.location = 'locationRequired';
  return errors;
}

/**
 * The checks of a settings save: the partial update the member may send, through the contract's
 * schema, each refusal on its field. Completeness (a city, an address, a pin and a phone) is the
 * wizard's (rule 3): a branch missing its pin still takes a manager's new phone.
 */
export function updateErrors(draft: LocationDraft, update: UpdateBranch): FieldErrors {
  const errors: FieldErrors =
    update.contactPhones !== undefined ? phoneErrors(draft.phones, { required: false }) : {};
  if (update.addressDescription !== undefined) {
    const address = addressError(update.addressDescription);
    if (address) errors.addressDescription = address;
  }
  const result = updateBranchSchema.safeParse(update);
  for (const issue of result.success ? [] : result.error.issues) {
    const [field] = issue.path;
    if (field === 'cityId') errors.cityId ??= 'cityRequired';
    else if (field === 'location') errors.location ??= 'locationRequired';
    else if (field === 'addressDescription') errors.addressDescription ??= 'addressRequired';
    else if (field === 'contactPhones' && !hasErrorsUnder(errors, 'phones')) {
      errors.phones = 'phoneInvalid';
    }
  }
  return errors;
}

/** Whether a typed phone can take WhatsApp: only a mobile number can. */
export function canHaveWhatsapp(phone: string): boolean {
  return parsePhoneNumber(phone)?.kind === 'mobile';
}

function contactPhones(phones: readonly PhoneDraft[]) {
  return typedPhones(phones).map((entry) => {
    const parsed = parsePhoneNumber(entry.phone);
    return {
      phone: parsed?.e164 ?? entry.phone,
      whatsapp: entry.whatsapp && parsed?.kind === 'mobile',
    };
  });
}

/** The location fields as a partial update: only what differs from the saved branch. */
export function locationUpdate(draft: LocationDraft, branch: Branch): UpdateBranch {
  const update: UpdateBranch = { updatedAt: branch.updatedAt };
  if (draft.cityId && draft.cityId !== branch.cityId) update.cityId = draft.cityId;
  const address = draft.addressDescription.trim();
  if (address !== (branch.addressDescription ?? '')) update.addressDescription = address;
  if (
    draft.location &&
    (draft.location.latitudeE7 !== branch.location?.latitudeE7 ||
      draft.location.longitudeE7 !== branch.location?.longitudeE7)
  ) {
    update.location = draft.location;
  }
  const phones = contactPhones(draft.phones);
  if (JSON.stringify(phones) !== JSON.stringify(branch.contactPhones)) {
    update.contactPhones = phones;
  }
  return update;
}

/** Whether an update changes anything beyond the `updatedAt` it carries. */
export function changesSomething(update: object): boolean {
  return Object.keys(update).some((key) => key !== 'updatedAt');
}

// Weekly hours (wizard step 3, branch hours).

export type PeriodDraft = { opensAt: string; closesAt: string };

export type HoursDraft = {
  businessDayEndsAt: string;
  /** The periods of each weekday, Saturday first. */
  days: PeriodDraft[][];
};

export function hoursDraft(
  businessDayEndsAt: string,
  periods: readonly WeeklyPeriod[],
): HoursDraft {
  return {
    businessDayEndsAt,
    days: weekdays.map((weekday) =>
      periods
        .filter((period) => period.weekday === weekday)
        .map(({ opensAt, closesAt }) => ({ opensAt, closesAt })),
    ),
  };
}

export const emptyHoursDraft = (): HoursDraft => hoursDraft(DEFAULT_BUSINESS_DAY_END, []);

/** Every day gets the periods of `from` (the "copy to all days" action). */
export function copyDayToAll(draft: HoursDraft, from: number): HoursDraft {
  const periods = draft.days[from] ?? [];
  return { ...draft, days: draft.days.map(() => periods.map((period) => ({ ...period }))) };
}

/** The business day ends on the hour or half hour, from 00:00 to 08:00. */
export const businessDayEnds = Array.from({ length: 17 }, (_, index) => {
  const minutes = index * 30;
  return `${String(Math.trunc(minutes / 60)).padStart(2, '0')}:${minutes % 60 ? '30' : '00'}`;
});

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A time as typed (`9`, `930`, `21:30`, `٠٩:٣٠`) as `HH:MM`, or the text unchanged when it is not
 * one; a typed time needs no picker, whose display follows the computer's locale.
 */
export function normalizeTime(text: string): string {
  const latin = text.trim().replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
  const match = /^(\d{1,2})(?:[:.٫]?(\d{2}))?$/.exec(latin);
  if (!match?.[1]) return text;
  const time = `${match[1].padStart(2, '0')}:${match[2] ?? '00'}`;
  return TIME.test(time) ? time : text;
}

/**
 * The checks of rule 12 for one day's periods: both times set, then the shared rule (no empty
 * period, none containing the business day end, no overlap). Errors are keyed `<prefix>.<index>`
 * for a period and `<prefix>` for the day.
 */
export function dayErrors(
  periods: readonly PeriodDraft[],
  businessDayEndsAt: string,
  prefix: string,
): FieldErrors {
  const errors: FieldErrors = {};
  periods.forEach((period, index) => {
    if (!TIME.test(period.opensAt) || !TIME.test(period.closesAt)) {
      errors[`${prefix}.${index}`] = 'periodIncomplete';
    }
  });
  if (Object.keys(errors).length > 0) return errors;
  try {
    validateDayPeriods(periods as OpeningPeriod[], businessDayEndsAt as OpeningPeriod['opensAt']);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    const offending = error.details?.period as OpeningPeriod | undefined;
    const index = periods.findIndex(
      (period) => period.opensAt === offending?.opensAt && period.closesAt === offending?.closesAt,
    );
    errors[index >= 0 ? `${prefix}.${index}` : prefix] = hoursProblem(error.message);
  }
  return errors;
}

/** The key of the text for an `INVALID_HOURS` refusal of the shared rule. */
function hoursProblem(message: string): ValidationKey {
  if (message.includes('same time')) return 'periodEmpty';
  if (message.includes('business day end')) return 'periodContainsDayEnd';
  if (message.includes('overlap')) return 'periodsOverlap';
  return 'periodsTooMany';
}

/** The weekly schedule's errors; the wizard also needs at least one opening period (rule 3). */
export function hoursErrors(draft: HoursDraft, { requireOpen }: { requireOpen: boolean }) {
  const errors: FieldErrors = {};
  draft.days.forEach((periods, index) => {
    Object.assign(errors, dayErrors(periods, draft.businessDayEndsAt, `days.${index}`));
  });
  if (requireOpen && draft.days.every((periods) => periods.length === 0)) {
    errors.days = 'hoursRequired';
  }
  return errors;
}

export function hoursInput(draft: HoursDraft, updatedAt: string): ReplaceBranchHours {
  return {
    businessDayEndsAt: draft.businessDayEndsAt as ReplaceBranchHours['businessDayEndsAt'],
    periods: draft.days.flatMap((periods, index) =>
      periods.map((period) => ({
        weekday: weekdays[index] as Weekday,
        opensAt: period.opensAt as OpeningPeriod['opensAt'],
        closesAt: period.closesAt as OpeningPeriod['closesAt'],
      })),
    ),
    updatedAt,
  };
}

/**
 * The text of a saved period in `restaurant:setup.review` (rule 12): "(next day)" after the
 * opening when the whole period falls after midnight, after the closing when only that does.
 */
export function periodTextKey(period: OpeningPeriod, businessDayEndsAt: string) {
  const next = periodNextDay(period, businessDayEndsAt as TimeOfDay);
  if (next.opens) return 'setup.review.periodNextDay' as const;
  return next.closes ? ('setup.review.periodOvernight' as const) : ('setup.review.period' as const);
}

export const canAddPeriod = (periods: readonly PeriodDraft[]) =>
  periods.length < MAX_PERIODS_PER_DAY;

export const canAddPhone = (phones: readonly PhoneDraft[]) => phones.length < MAX_CONTACT_PHONES;

// Currencies and charge lines (wizard step 4, branch settings).

export type ChargeDraft = {
  kind: ChargeKind;
  nameAr: string;
  nameLatin: string;
  /** The rate as typed, in percent (`10`, `2.5`). */
  rate: string;
  mode: ChargeMode;
  orderTypes: OrderType[];
};

export type MoneyDraft = {
  defaultCurrency: CurrencyCode;
  acceptedCurrencies: CurrencyCode[];
  charges: ChargeDraft[];
};

export function moneyDraft(branch: Branch, charges: readonly BranchCharge[]): MoneyDraft {
  return {
    defaultCurrency: branch.defaultCurrency,
    acceptedCurrencies: [...branch.acceptedCurrencies],
    charges: charges.map((charge) => ({
      kind: charge.kind,
      nameAr: charge.nameAr,
      nameLatin: charge.nameLatin ?? '',
      rate: formatRateBp(charge.rateBp),
      mode: charge.mode,
      orderTypes: [...charge.orderTypes],
    })),
  };
}

export const newCharge = (): ChargeDraft => ({
  kind: 'service',
  nameAr: '',
  nameLatin: '',
  rate: '',
  mode: 'added',
  orderTypes: [...orderTypes],
});

export const canAddCharge = (charges: readonly ChargeDraft[]) => charges.length < MAX_CHARGE_LINES;

/**
 * A percent as typed (`10`, `2.5`, `٢٫٥`) to basis points, or undefined: at most two decimals,
 * from 0.01 to 50, read digit by digit, never through a float.
 */
export function parseRate(text: string): number | undefined {
  const latin = text
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[٫,]/g, '.');
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(latin);
  if (!match?.[1]) return undefined;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return basisPoints >= 1 && basisPoints <= 5000 ? basisPoints : undefined;
}

export function moneyErrors(draft: MoneyDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.acceptedCurrencies.includes(draft.defaultCurrency)) {
    errors.acceptedCurrencies = 'defaultNotAccepted';
  }
  const { nameAr, nameLatin } = branchChargeInputSchema.shape;
  draft.charges.forEach((charge, index) => {
    if (!nameAr.safeParse(charge.nameAr).success)
      errors[`charges.${index}.nameAr`] = 'chargeNameAr';
    const latin = charge.nameLatin.trim();
    if (latin && !nameLatin.safeParse(latin).success) {
      errors[`charges.${index}.nameLatin`] = 'chargeNameLatin';
    }
    if (parseRate(charge.rate) === undefined) errors[`charges.${index}.rate`] = 'chargeRate';
    if (charge.orderTypes.length === 0) errors[`charges.${index}.orderTypes`] = 'chargeOrderTypes';
  });
  return errors;
}

/** The currency fields as a partial update: only what differs from the saved branch. */
export function currencyUpdate(draft: MoneyDraft, branch: Branch): UpdateBranch {
  const update: UpdateBranch = { updatedAt: branch.updatedAt };
  if (draft.defaultCurrency !== branch.defaultCurrency) {
    update.defaultCurrency = draft.defaultCurrency;
  }
  const accepted = [...draft.acceptedCurrencies].sort();
  if (JSON.stringify(accepted) !== JSON.stringify([...branch.acceptedCurrencies].sort())) {
    update.acceptedCurrencies = draft.acceptedCurrencies;
  }
  return update;
}

export function chargeLines(draft: MoneyDraft): BranchChargeInput[] {
  return draft.charges.map((charge) => ({
    kind: charge.kind,
    nameAr: charge.nameAr.trim(),
    nameLatin: charge.nameLatin.trim() || null,
    rateBp: parseRate(charge.rate) ?? 0,
    mode: charge.mode,
    orderTypes: orderTypes.filter((type) => charge.orderTypes.includes(type)),
  }));
}

/** Whether the lines differ from the saved ones (their order is their position). */
export function chargesChanged(draft: MoneyDraft, saved: readonly BranchCharge[]): boolean {
  const current = saved.map((charge) => ({
    kind: charge.kind,
    nameAr: charge.nameAr,
    nameLatin: charge.nameLatin,
    rateBp: charge.rateBp,
    mode: charge.mode,
    orderTypes: orderTypes.filter((type) => charge.orderTypes.includes(type)),
  }));
  return JSON.stringify(chargeLines(draft)) !== JSON.stringify(current);
}

/** A field's own errors and its children's (`charges.0` holds `charges.0.rate`). */
export function hasErrorsUnder(errors: FieldErrors, prefix: string): boolean {
  return Object.keys(errors).some((key) => key === prefix || key.startsWith(`${prefix}.`));
}

// A branch's three drafts, as the wizard and the single-branch settings hold them.

export type BranchDraft = { location: LocationDraft; hours: HoursDraft; money: MoneyDraft };

export type BranchDrafts = Record<string, BranchDraft>;

export function branchDraft(detail: BranchDetail): BranchDraft {
  return {
    location: locationDraft(detail.branch),
    hours: hoursDraft(detail.branch.businessDayEndsAt, detail.hours),
    money: moneyDraft(detail.branch, detail.charges),
  };
}

export function branchDrafts(details: readonly BranchDetail[]): BranchDrafts {
  return Object.fromEntries(details.map((detail) => [detail.branch.id, branchDraft(detail)]));
}

/** Whether the hours draft holds the saved schedule (nothing to send). */
export function sameHours(draft: HoursDraft, detail: BranchDetail): boolean {
  const sent = hoursInput(draft, detail.branch.updatedAt);
  const saved = hoursInput(hoursDraft(detail.branch.businessDayEndsAt, detail.hours), '');
  return (
    sent.businessDayEndsAt === saved.businessDayEndsAt &&
    JSON.stringify(sent.periods) === JSON.stringify(saved.periods)
  );
}

// Dated exceptions (rule 13): closed, or one or two periods under the weekly rules.

export type ExceptionDraft = {
  date: string | undefined;
  closed: boolean;
  periods: PeriodDraft[];
  note: string;
};

export function exceptionDraft(exception?: HourException): ExceptionDraft {
  return exception
    ? {
        date: exception.date,
        closed: exception.closed,
        periods: exception.periods.map((period) => ({ ...period })),
        note: exception.note ?? '',
      }
    : { date: undefined, closed: true, periods: [], note: '' };
}

export function exceptionErrors(draft: ExceptionDraft, businessDayEndsAt: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.date) errors.date = 'exceptionDate';
  if (!draft.closed) {
    if (draft.periods.length === 0) errors.periods = 'exceptionPeriods';
    Object.assign(errors, dayErrors(draft.periods, businessDayEndsAt, 'periods'));
  }
  if (draft.note.trim().length > 100) errors.note = 'noteTooLong';
  return errors;
}

export function exceptionInput(
  draft: ExceptionDraft,
): Required<Omit<CreateHourException, 'date' | 'note'>> & { note: string | null } {
  return {
    closed: draft.closed,
    periods: draft.closed
      ? []
      : draft.periods.map((period) => ({
          opensAt: period.opensAt as OpeningPeriod['opensAt'],
          closesAt: period.closesAt as OpeningPeriod['closesAt'],
        })),
    note: draft.note.trim() || null,
  };
}

/**
 * The drafts after the branches were read again (a `CONFLICT`, rule 16, or a refused finish): a
 * branch the server still holds as last saved keeps the owner's unsent draft; one that changed
 * starts again from the server; a branch added meanwhile gets its draft; an archived one is gone.
 */
export function reconcileDrafts(
  saved: readonly BranchDetail[],
  drafts: BranchDrafts,
  fresh: readonly BranchDetail[],
): BranchDrafts {
  return Object.fromEntries(
    fresh.map((detail) => {
      const id = detail.branch.id;
      const known = saved.find((item) => item.branch.id === id);
      const draft = drafts[id];
      const unchanged = known?.branch.updatedAt === detail.branch.updatedAt;
      return [id, unchanged && draft ? draft : branchDraft(detail)];
    }),
  );
}
