import {
  type BranchChargeInput,
  chargeKindSchema,
  chargeModeSchema,
  formatRateBp,
} from '@vertex-food/contracts';
import {
  Button,
  Card,
  Checkbox,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@vertex-food/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldGroup } from '../../components/field-group';
import {
  type ChargeDraft,
  canAddCharge,
  type FieldErrors,
  hasErrorsUnder,
  type MoneyDraft,
  newCharge,
  parseRate,
  salesChannels,
} from './branch-draft';
import { currencyCodes } from './profile-fields';

/**
 * Currencies and charge lines (wizard step 4, branch settings): the default currency that prices
 * the menu (fixed once the first order is recorded, rule 11), the accepted ones (always with the
 * default), and up to three tax or service lines with how each reads on a receipt (rule 15).
 */
export function MoneyFields({
  draft,
  onChange,
  errors,
  disabled,
  currencyLocked,
}: {
  draft: MoneyDraft;
  onChange: (next: (current: MoneyDraft) => MoneyDraft) => void;
  errors: FieldErrors;
  disabled: boolean;
  currencyLocked: boolean;
}) {
  const { t } = useTranslation('restaurant');
  const setCharge = (index: number, patch: Partial<ChargeDraft>) =>
    onChange((current) => ({
      ...current,
      charges: current.charges.map((charge, at) =>
        at === index ? { ...charge, ...patch } : charge,
      ),
    }));

  return (
    <div className="flex flex-col gap-6">
      <Field disabled={disabled || currencyLocked}>
        <FieldLabel render={<span />}>{t('fields.defaultCurrency.label')}</FieldLabel>
        <Select
          value={draft.defaultCurrency}
          onValueChange={(code) => {
            if (!code) return;
            onChange((current) => ({
              ...current,
              defaultCurrency: code,
              acceptedCurrencies: current.acceptedCurrencies.includes(code)
                ? current.acceptedCurrencies
                : [code, ...current.acceptedCurrencies],
            }));
          }}
          items={currencyCodes.map((code) => ({ value: code, label: t(`currencies.${code}`) }))}
          disabled={disabled || currencyLocked}
        >
          <SelectTrigger aria-label={t('fields.defaultCurrency.label')} className="sm:max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {currencyCodes.map((code) => (
              <SelectItem key={code} value={code}>
                {t(`currencies.${code}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          {currencyLocked
            ? t('fields.defaultCurrency.locked')
            : t('fields.defaultCurrency.description')}
        </FieldDescription>
      </Field>
      <FieldGroup
        legend={t('fields.acceptedCurrencies.label')}
        description={t('fields.acceptedCurrencies.description')}
        error={errors.acceptedCurrencies ? t(`validation.${errors.acceptedCurrencies}`) : undefined}
        disabled={disabled}
      >
        <div className="flex flex-wrap gap-4">
          {currencyCodes.map((code) => (
            // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's checkbox renders the control inside the label.
            <label key={code} className="flex items-center gap-2">
              <Checkbox
                checked={draft.acceptedCurrencies.includes(code)}
                // The default is always accepted (rule 11).
                disabled={disabled || code === draft.defaultCurrency}
                onCheckedChange={(checked) =>
                  onChange((current) => ({
                    ...current,
                    acceptedCurrencies: checked
                      ? [...current.acceptedCurrencies, code]
                      : current.acceptedCurrencies.filter((item) => item !== code),
                  }))
                }
              />
              {t(`currencies.${code}`)}
            </label>
          ))}
        </div>
      </FieldGroup>
      <FieldGroup
        legend={t('fields.charges.label')}
        description={t('fields.charges.description')}
        disabled={disabled}
      >
        {draft.charges.length === 0 && (
          <p className="text-muted-foreground">{t('fields.charges.empty')}</p>
        )}
        <ol className="flex flex-col gap-4">
          {draft.charges.map((charge, index) => (
            <ChargeRow
              // biome-ignore lint/suspicious/noArrayIndexKey: a line's place is its position.
              key={index}
              number={index + 1}
              charge={charge}
              errors={errors}
              prefix={`charges.${index}`}
              disabled={disabled}
              onChange={(patch) => setCharge(index, patch)}
              onRemove={() =>
                onChange((current) => ({
                  ...current,
                  charges: current.charges.filter((_, at) => at !== index),
                }))
              }
            />
          ))}
        </ol>
        {canAddCharge(draft.charges) && (
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={disabled}
            onClick={() =>
              onChange((current) => ({ ...current, charges: [...current.charges, newCharge()] }))
            }
          >
            <Plus aria-hidden />
            {t('fields.charges.add')}
          </Button>
        )}
      </FieldGroup>
    </div>
  );
}

const kinds = chargeKindSchema.options;
const modes = chargeModeSchema.options;

function ChargeRow({
  number,
  charge,
  errors,
  prefix,
  disabled,
  onChange,
  onRemove,
}: {
  number: number;
  charge: ChargeDraft;
  errors: FieldErrors;
  prefix: string;
  disabled: boolean;
  onChange: (patch: Partial<ChargeDraft>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('restaurant');
  const nameArId = useId();
  const nameLatinId = useId();
  const rateId = useId();
  const error = (field: string) => errors[`${prefix}.${field}`];
  const rateBp = parseRate(charge.rate);
  return (
    <li>
      <Card
        className="gap-4 p-4"
        data-form-invalid={hasErrorsUnder(errors, prefix) ? '' : undefined}
        aria-label={t('fields.charges.line', { number })}
        role="group"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-bold">{t('fields.charges.line', { number })}</h3>
          <IconButton
            label={t('fields.charges.remove', { number })}
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2 />
          </IconButton>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field disabled={disabled}>
            <FieldLabel render={<span />}>{t('fields.charges.kind')}</FieldLabel>
            <Select
              value={charge.kind}
              onValueChange={(kind: BranchChargeInput['kind'] | null) => kind && onChange({ kind })}
              items={kinds.map((kind) => ({
                value: kind,
                label: t(`fields.charges.kinds.${kind}`),
              }))}
              disabled={disabled}
            >
              <SelectTrigger aria-label={t('fields.charges.kind')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {t(`fields.charges.kinds.${kind}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field invalid={error('rate') !== undefined} disabled={disabled}>
            <FieldLabel htmlFor={rateId}>{t('fields.charges.rate')}</FieldLabel>
            <Input
              id={rateId}
              dir="ltr"
              inputMode="decimal"
              className="w-28"
              value={charge.rate}
              onChange={(event) => onChange({ rate: event.currentTarget.value })}
            />
            <FieldError match={error('rate') !== undefined}>
              {t('validation.chargeRate')}
            </FieldError>
          </Field>
          <Field invalid={error('nameAr') !== undefined} disabled={disabled}>
            <FieldLabel htmlFor={nameArId}>{t('fields.charges.nameAr')}</FieldLabel>
            <Input
              id={nameArId}
              maxLength={40}
              value={charge.nameAr}
              onChange={(event) => onChange({ nameAr: event.currentTarget.value })}
            />
            <FieldError match={error('nameAr') !== undefined}>
              {t('validation.chargeNameAr')}
            </FieldError>
          </Field>
          <Field invalid={error('nameLatin') !== undefined} disabled={disabled}>
            <FieldLabel htmlFor={nameLatinId}>{t('fields.charges.nameLatin')}</FieldLabel>
            <Input
              id={nameLatinId}
              dir="ltr"
              maxLength={40}
              value={charge.nameLatin}
              onChange={(event) => onChange({ nameLatin: event.currentTarget.value })}
            />
            <FieldError match={error('nameLatin') !== undefined}>
              {t('validation.chargeNameLatin')}
            </FieldError>
          </Field>
          <Field disabled={disabled}>
            <FieldLabel render={<span />}>{t('fields.charges.mode')}</FieldLabel>
            <Select
              value={charge.mode}
              onValueChange={(mode: BranchChargeInput['mode'] | null) => mode && onChange({ mode })}
              items={modes.map((mode) => ({
                value: mode,
                label: t(`fields.charges.modes.${mode}`),
              }))}
              disabled={disabled}
            >
              <SelectTrigger aria-label={t('fields.charges.mode')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modes.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(`fields.charges.modes.${mode}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <FieldGroup
          legend={t('fields.charges.orderTypes')}
          error={error('salesChannels') ? t('validation.chargeOrderTypes') : undefined}
          disabled={disabled}
        >
          <div className="flex flex-wrap gap-4">
            {salesChannels.map((type) => (
              // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's checkbox renders the control inside the label.
              <label key={type} className="flex items-center gap-2">
                <Checkbox
                  checked={charge.salesChannels.includes(type)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onChange({
                      salesChannels: checked
                        ? [...charge.salesChannels, type]
                        : charge.salesChannels.filter((item) => item !== type),
                    })
                  }
                />
                {t(`orderTypes.${type}`)}
              </label>
            ))}
          </div>
        </FieldGroup>
        {rateBp !== undefined && charge.nameAr.trim() && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            {t(`fields.charges.example.${charge.mode}`, {
              name: charge.nameAr.trim(),
              rate: formatRateBp(rateBp),
            })}
          </p>
        )}
      </Card>
    </li>
  );
}
