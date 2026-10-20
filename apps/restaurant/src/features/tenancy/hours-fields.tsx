import { type OpeningPeriod, periodNextDay, type TimeOfDay } from '@vertex-food/contracts';

import {
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  IconButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@vertex-food/ui';
import { CopyPlus, Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  businessDayEnds,
  canAddPeriod,
  copyDayToAll,
  type FieldErrors,
  type HoursDraft,
  normalizeTime,
  type PeriodDraft,
  type ValidationKey,
  weekdayKey,
  weekdays,
} from './branch-draft';

/**
 * The weekly schedule (wizard step 3, branch hours): up to two periods a day, a period past
 * midnight shown as "next day", "copy to all days", and the business day end (rule 12).
 */
export function HoursFields({
  draft,
  onChange,
  errors,
  disabled,
}: {
  draft: HoursDraft;
  onChange: (next: (current: HoursDraft) => HoursDraft) => void;
  errors: FieldErrors;
  disabled: boolean;
}) {
  const { t } = useTranslation('restaurant');
  const daysErrorId = useId();
  const setDay = (index: number, periods: PeriodDraft[]) =>
    onChange((current) => ({
      ...current,
      days: current.days.map((day, at) => (at === index ? periods : day)),
    }));

  return (
    <div className="flex flex-col gap-6">
      <Field disabled={disabled}>
        <FieldLabel render={<span />}>{t('fields.dayEnd.label')}</FieldLabel>
        <Select
          value={draft.businessDayEndsAt}
          onValueChange={(time) => {
            if (time) onChange((current) => ({ ...current, businessDayEndsAt: time }));
          }}
          items={businessDayEnds.map((time) => ({ value: time, label: time }))}
          disabled={disabled}
        >
          <SelectTrigger aria-label={t('fields.dayEnd.label')} className="w-40 min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {businessDayEnds.map((time) => (
              <SelectItem key={time} value={time}>
                {time}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>{t('fields.dayEnd.description')}</FieldDescription>
      </Field>
      <fieldset
        disabled={disabled}
        aria-describedby={errors.days ? daysErrorId : undefined}
        aria-invalid={errors.days ? true : undefined}
        data-form-invalid={errors.days ? '' : undefined}
        className="flex min-w-0 flex-col gap-2"
      >
        <legend className="mb-2 text-sm font-medium">{t('fields.hours.label')}</legend>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {weekdays.map((weekday, index) => (
            <DayRow
              key={weekday}
              day={t(`weekdays.${weekdayKey(weekday)}`)}
              periods={draft.days[index] ?? []}
              errors={errors}
              prefix={`days.${index}`}
              dayEnd={draft.businessDayEndsAt}
              disabled={disabled}
              onChange={(periods) => setDay(index, periods)}
              onCopy={() => onChange((current) => copyDayToAll(current, index))}
            />
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">{t('fields.hours.description')}</p>
        {/* Announced when it appears; the fieldset names it as its description. */}
        {errors.days && (
          <p id={daysErrorId} role="alert" className="text-sm text-destructive-text">
            {t(`validation.${errors.days}`)}
          </p>
        )}
      </fieldset>
    </div>
  );
}

function DayRow({
  day,
  periods,
  errors,
  prefix,
  dayEnd,
  disabled,
  onChange,
  onCopy,
}: {
  day: string;
  periods: PeriodDraft[];
  errors: FieldErrors;
  prefix: string;
  dayEnd: string;
  disabled: boolean;
  onChange: (periods: PeriodDraft[]) => void;
  onCopy: () => void;
}) {
  const { t } = useTranslation('restaurant');
  const dayError = errors[prefix];
  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
      <span className="w-24 shrink-0 pt-1.5 font-medium">{day}</span>
      <div className="flex flex-1 flex-col gap-2">
        {periods.length === 0 && (
          <span className="pt-1.5 text-muted-foreground">{t('fields.hours.closed')}</span>
        )}
        {periods.map((period, index) => (
          <PeriodRow
            // biome-ignore lint/suspicious/noArrayIndexKey: a period's place is its name ("period 2").
            key={index}
            day={day}
            number={index + 1}
            period={period}
            dayEnd={dayEnd}
            error={errors[`${prefix}.${index}`]}
            disabled={disabled}
            onChange={(next) => onChange(periods.map((item, at) => (at === index ? next : item)))}
            onRemove={() => onChange(periods.filter((_, at) => at !== index))}
          />
        ))}
        {dayError && (
          <p role="alert" className="text-sm text-destructive-text">
            {t(`validation.${dayError}`)}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canAddPeriod(periods) && (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() =>
              onChange([
                ...periods,
                periods.length === 0
                  ? { opensAt: '10:00', closesAt: '23:00' }
                  : { opensAt: '', closesAt: '' },
              ])
            }
          >
            <Plus aria-hidden />
            {t('fields.hours.addPeriod')}
          </Button>
        )}
        <IconButton
          label={t('fields.hours.copyToAll', { day })}
          disabled={disabled}
          onClick={onCopy}
        >
          <CopyPlus />
        </IconButton>
      </div>
    </li>
  );
}

const TIME = /^\d{2}:\d{2}$/;

/**
 * One opening period: opens and closes as typed times, "next day" after each time that falls on
 * the next calendar day (rule 12): past midnight, or the whole period when it opens after
 * midnight but before the business day end. Its error is tied to both times and announced.
 */
export function PeriodRow({
  day,
  number,
  period,
  dayEnd,
  error,
  disabled,
  onChange,
  onRemove,
}: {
  day: string;
  number: number;
  period: PeriodDraft;
  /** The branch's business day end, `HH:MM`. */
  dayEnd: string;
  error: ValidationKey | undefined;
  disabled: boolean;
  onChange: (period: PeriodDraft) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('restaurant');
  const errorId = useId();
  const nextDay =
    TIME.test(period.opensAt) && TIME.test(period.closesAt) && TIME.test(dayEnd)
      ? periodNextDay(period as OpeningPeriod, dayEnd as TimeOfDay)
      : { opens: false, closes: false };
  const nextDayMark = (
    <span className="text-sm text-muted-foreground">{t('fields.hours.nextDay')}</span>
  );
  const time = (key: 'opensAt' | 'closesAt') => (
    <Input
      dir="ltr"
      inputMode="numeric"
      aria-label={t(`fields.hours.${key}`, { day, number })}
      aria-invalid={error !== undefined}
      aria-describedby={error ? errorId : undefined}
      aria-errormessage={error ? errorId : undefined}
      placeholder={t('fields.hours.timePlaceholder')}
      className="w-20 text-center"
      value={period[key]}
      disabled={disabled}
      onChange={(event) => onChange({ ...period, [key]: event.currentTarget.value })}
      onBlur={(event) => onChange({ ...period, [key]: normalizeTime(event.currentTarget.value) })}
    />
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{t('fields.hours.from')}</span>
        {time('opensAt')}
        {nextDay.opens && nextDayMark}
        <span className="text-sm text-muted-foreground">{t('fields.hours.to')}</span>
        {time('closesAt')}
        {nextDay.closes && !nextDay.opens && nextDayMark}
        <IconButton
          label={t('fields.hours.removePeriod', { day, number })}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 />
        </IconButton>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive-text">
          {t(`validation.${error}`)}
        </p>
      )}
    </div>
  );
}
