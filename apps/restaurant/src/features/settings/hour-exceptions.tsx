import { useMutation } from '@tanstack/react-query';
import {
  addDays,
  type BranchDetail,
  businessDateOf,
  type HourException,
  isOvernight,
  type Tenant,
  type TimeOfDay,
} from '@vertex-food/contracts';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  Form,
  FormActions,
  FormFields,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@vertex-food/ui';
import { CalendarOff, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldGroup } from '../../components/field-group';
import { ApiError } from '../../lib/api';
import { useErrorText } from '../../lib/error-text';
import { formatDate } from '../../lib/format';
import { useOnline } from '../../lib/online';
import { can, useStaffAccess } from '../../lib/staff-access';
import {
  canAddPeriod,
  type ExceptionDraft,
  exceptionDraft,
  exceptionErrors,
  exceptionInput,
} from '../tenancy/branch-draft';
import { PeriodRow } from '../tenancy/hours-fields';
import {
  createException,
  removeException,
  updateException,
  useSetupCache,
} from '../tenancy/queries';
import { isTenantWritable } from '../tenancy/tenant-status';
import type { Notice } from './save-actions';

/** How far ahead an exception can be planned from the hours screen. */
const PLANNING_DAYS = 120;

/**
 * The upcoming exceptions of a branch (rule 13): a dated day that replaces the weekly periods,
 * closed or with its own periods. Past ones are kept on the server but are not shown or changed.
 */
export function HourExceptions({ tenant, detail }: { tenant: Tenant; detail: BranchDetail }) {
  const { t } = useTranslation('restaurant');
  const access = useStaffAccess();
  const online = useOnline();
  const allowed =
    isTenantWritable(tenant) && can(access, 'branch.hours.edit', detail.branch.id) && online;
  /** The exception being edited, or `'new'`. */
  const [editing, setEditing] = useState<HourException | 'new'>();
  const exceptions = [...detail.exceptions].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.exceptions.title')}</CardTitle>
        <CardDescription>{t('settings.exceptions.description')}</CardDescription>
      </CardHeader>
      {exceptions.length === 0 && editing !== 'new' ? (
        <EmptyState icon={<CalendarOff />} title={t('settings.exceptions.empty')} />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {exceptions.map((exception) =>
            editing !== 'new' && editing?.id === exception.id ? (
              <li key={exception.id} className="p-3">
                <ExceptionEditor
                  detail={detail}
                  exception={exception}
                  onDone={() => setEditing(undefined)}
                />
              </li>
            ) : (
              <ExceptionRow
                key={exception.id}
                detail={detail}
                exception={exception}
                allowed={allowed && editing === undefined}
                onEdit={() => setEditing(exception)}
              />
            ),
          )}
        </ul>
      )}
      {editing === 'new' ? (
        <ExceptionEditor detail={detail} onDone={() => setEditing(undefined)} />
      ) : (
        allowed &&
        editing === undefined && (
          <Button variant="outline" className="w-fit" onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            {t('settings.exceptions.add')}
          </Button>
        )
      )}
    </Card>
  );
}

function ExceptionRow({
  detail,
  exception,
  allowed,
  onEdit,
}: {
  detail: BranchDetail;
  exception: HourException;
  allowed: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation('restaurant');
  const errorText = useErrorText();
  const cache = useSetupCache();
  const [problem, setProblem] = useState<string>();
  const remove = useMutation({
    mutationFn: async () => {
      await removeException(detail.branch.id, exception.id);
      await cache.reloadBranch(detail.branch.id);
    },
    onMutate: () => setProblem(undefined),
    onSuccess: () => toast.add({ title: t('settings.exceptions.removed'), type: 'success' }),
    onError: (error) => {
      setProblem(errorText(error));
      void cache.refused(error);
    },
  });
  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-medium">{formatDate(exception.date)}</span>
          <span className="text-sm text-muted-foreground">
            {exception.closed ? (
              <Badge tone="neutral">{t('settings.exceptions.closedBadge')}</Badge>
            ) : (
              exception.periods
                .map((period) =>
                  t(isOvernight(period) ? 'setup.review.periodOvernight' : 'setup.review.period', {
                    opensAt: period.opensAt,
                    closesAt: period.closesAt,
                  }),
                )
                .join('، ')
            )}
            {exception.note && <span className="ms-2">{exception.note}</span>}
          </span>
        </div>
        {allowed && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
              aria-label={t('settings.exceptions.editNamed', { date: formatDate(exception.date) })}
            >
              {t('settings.exceptions.edit')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={remove.isPending}
              onClick={() => remove.mutate()}
              aria-label={t('settings.exceptions.removeNamed', {
                date: formatDate(exception.date),
              })}
            >
              {t('settings.exceptions.remove')}
            </Button>
          </div>
        )}
      </div>
      {problem && <p className="text-sm text-destructive-text">{problem}</p>}
    </li>
  );
}

/** Adds an exception, or changes one; its date is fixed once it exists. */
function ExceptionEditor({
  detail,
  exception,
  onDone,
}: {
  detail: BranchDetail;
  exception?: HourException;
  onDone: () => void;
}) {
  const { t } = useTranslation('restaurant');
  const errorText = useErrorText();
  const cache = useSetupCache();
  const noteId = useId();
  // Offline, the editor keeps its values but changes nothing (S01).
  const online = useOnline();
  const [draft, setDraft] = useState<ExceptionDraft>(() => exceptionDraft(exception));
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const dayEnd = detail.branch.businessDayEndsAt;
  const errors = checking ? exceptionErrors(draft, dayEnd) : {};
  const branchId = detail.branch.id;

  // From today's business date on: past exceptions cannot be created (rule 13).
  const today = businessDateOf(new Date(), dayEnd as TimeOfDay);
  const taken = new Set(detail.exceptions.map((item) => item.date));
  const dates = Array.from({ length: PLANNING_DAYS }, (_, index) => addDays(today, index)).filter(
    (date) => !taken.has(date) || date === exception?.date,
  );

  const save = useMutation({
    mutationFn: async () => {
      const input = exceptionInput(draft);
      if (exception) {
        await updateException(branchId, exception.id, { ...input, updatedAt: exception.updatedAt });
      } else {
        await createException(branchId, { ...input, date: draft.date as string });
      }
      await cache.reloadBranch(branchId);
    },
    onMutate: () => setNotice(undefined),
    onSuccess: () => {
      toast.add({ title: t('states.saved'), type: 'success' });
      onDone();
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        // Another editor changed it, or took the date: show the current list.
        await cache.reloadBranch(branchId).catch(() => undefined);
        setNotice({ tone: 'warning', text: t('settings.exceptions.conflict') });
        return;
      }
      setNotice({ tone: 'danger', text: errorText(error) });
      void cache.refused(error);
    },
  });

  return (
    <Form
      onSubmit={() => {
        setChecking(true);
        if (Object.keys(exceptionErrors(draft, dayEnd)).length > 0) return false;
        save.mutate();
        return true;
      }}
      busy={save.isPending}
      className="flex flex-col gap-4 rounded-md border border-border p-4"
      aria-label={exception ? t('settings.exceptions.edit') : t('settings.exceptions.add')}
    >
      <FormFields>
        <Field invalid={errors.date !== undefined} disabled={exception !== undefined || !online}>
          <FieldLabel render={<span />}>{t('settings.exceptions.date')}</FieldLabel>
          <Select
            value={draft.date ?? null}
            onValueChange={(date) => date && setDraft((current) => ({ ...current, date }))}
            items={dates.map((date) => ({ value: date, label: formatDate(date) }))}
            disabled={exception !== undefined || !online}
          >
            <SelectTrigger aria-label={t('settings.exceptions.date')} className="sm:max-w-xs">
              <SelectValue placeholder={t('settings.exceptions.datePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {dates.map((date) => (
                <SelectItem key={date} value={date}>
                  {formatDate(date)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError match={errors.date !== undefined}>{t('validation.exceptionDate')}</FieldError>
        </Field>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI's checkbox renders the control inside the label. */}
        <label className="flex items-center gap-2">
          <Checkbox
            checked={draft.closed}
            disabled={!online}
            onCheckedChange={(closed) =>
              setDraft((current) => ({
                ...current,
                closed,
                periods:
                  !closed && current.periods.length === 0
                    ? [{ opensAt: '', closesAt: '' }]
                    : current.periods,
              }))
            }
          />
          {t('settings.exceptions.closed')}
        </label>
        {!draft.closed && (
          <FieldGroup
            legend={t('settings.exceptions.periods')}
            error={errors.periods ? t(`validation.${errors.periods}`) : undefined}
          >
            {draft.periods.map((period, index) => (
              <PeriodRow
                // biome-ignore lint/suspicious/noArrayIndexKey: a period's place is its name ("period 2").
                key={index}
                day={draft.date ? formatDate(draft.date) : t('settings.exceptions.date')}
                number={index + 1}
                period={period}
                error={errors[`periods.${index}`]}
                disabled={!online}
                onChange={(next) =>
                  setDraft((current) => ({
                    ...current,
                    periods: current.periods.map((item, at) => (at === index ? next : item)),
                  }))
                }
                onRemove={() =>
                  setDraft((current) => ({
                    ...current,
                    periods: current.periods.filter((_, at) => at !== index),
                  }))
                }
              />
            ))}
            {canAddPeriod(draft.periods) && (
              <Button
                variant="ghost"
                size="sm"
                className="w-fit"
                disabled={!online}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    periods: [...current.periods, { opensAt: '', closesAt: '' }],
                  }))
                }
              >
                <Plus aria-hidden />
                {t('fields.hours.addPeriod')}
              </Button>
            )}
          </FieldGroup>
        )}
        <Field invalid={errors.note !== undefined} disabled={!online}>
          <FieldLabel htmlFor={noteId}>{t('settings.exceptions.note')}</FieldLabel>
          <Input
            id={noteId}
            maxLength={100}
            value={draft.note}
            onChange={(event) => {
              const note = event.currentTarget.value;
              setDraft((current) => ({ ...current, note }));
            }}
          />
        </Field>
      </FormFields>
      <FormActions>
        <Button type="submit" loading={save.isPending} disabled={!online}>
          {t('settings.exceptions.save')}
        </Button>
        <Button variant="ghost" disabled={save.isPending} onClick={onDone}>
          {t('settings.exceptions.cancel')}
        </Button>
      </FormActions>
      {notice && <Callout role="alert" tone={notice.tone} title={notice.text} />}
    </Form>
  );
}
