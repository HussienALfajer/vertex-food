import { isOvernight, type OpeningPeriod } from '@vertex-food/contracts';
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
              disabled={disabled}
              onChange={(periods) => setDay(index, periods)}
              onCopy={() => onChange((current) => copyDayToAll(current, index))}
            />
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">{t('fields.hours.description')}</p>
        {errors.days && (
          <p className="text-sm text-destructive-text">{t(`validation.${errors.days}`)}</p>
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
  disabled,
  onChange,
  onCopy,
}: {
  day: string;
  periods: PeriodDraft[];
  errors: FieldErrors;
  prefix: string;
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
            error={errors[`${prefix}.${index}`]}
            disabled={disabled}
            onChange={(next) => onChange(periods.map((item, at) => (at === index ? next : item)))}
            onRemove={() => onChange(periods.filter((_, at) => at !== index))}
          />
        ))}
        {dayError && <p className="text-sm text-destructive-text">{t(`validation.${dayError}`)}</p>}
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

/** One opening period: opens and closes as typed times, "next day" past midnight. */
export function PeriodRow({
  day,
  number,
  period,
  error,
  disabled,
  onChange,
  onRemove,
}: {
  day: string;
  number: number;
  period: PeriodDraft;
  error: ValidationKey | undefined;
  disabled: boolean;
  onChange: (period: PeriodDraft) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('restaurant');
  const overnight =
    TIME.test(period.opensAt) && TIME.test(period.closesAt) && isOvernight(period as OpeningPeriod);
  const time = (key: 'opensAt' | 'closesAt') => (
    <Input
      dir="ltr"
      inputMode="numeric"
      aria-label={t(`fields.hours.${key}`, { day, number })}
      aria-invalid={error !== undefined}
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
        <span className="text-sm text-muted-foreground">{t('fields.hours.to')}</span>
        {time('closesAt')}
        {overnight && (
          <span className="text-sm text-muted-foreground">{t('fields.hours.nextDay')}</span>
        )}
        <IconButton
          label={t('fields.hours.removePeriod', { day, number })}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 />
        </IconButton>
      </div>
      {error && <p className="text-sm text-destructive-text">{t(`validation.${error}`)}</p>}
    </div>
  );
}
