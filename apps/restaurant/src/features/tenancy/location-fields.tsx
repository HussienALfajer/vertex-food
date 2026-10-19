import { useQuery } from '@tanstack/react-query';
import {
  type Coordinates,
  isInServiceRegion,
  isMapLinkHost,
  parseCoordinatesText,
} from '@vertex-food/contracts';
import {
  Button,
  Callout,
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
  Skeleton,
  Switch,
  Textarea,
} from '@vertex-food/ui';
import { Loader2, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldGroup } from '../../components/field-group';
import { useErrorText } from '../../lib/error-text';
import {
  canAddPhone,
  canHaveWhatsapp,
  type FieldErrors,
  type LocationDraft,
  type PhoneDraft,
} from './branch-draft';
import { citiesQuery, resolveMapLink } from './queries';

type FieldsProps = {
  draft: LocationDraft;
  onChange: (patch: Partial<LocationDraft>) => void;
  errors: FieldErrors;
  /** The address, city and pin need `branch.settings.edit`. */
  disabled: boolean;
  /** The phones need `branch.hours.edit`: a branch manager edits them alone. */
  phonesDisabled: boolean;
};

/**
 * Where the restaurant is and how to reach it (wizard step 2, branch settings): governorate and
 * city, the address description, the pin from pasted coordinates or a map link (rule 20), and one
 * to three contact phones.
 */
export function LocationFields(props: FieldsProps) {
  const { t } = useTranslation('restaurant');
  const { draft, onChange, errors, disabled } = props;
  const addressId = useId();
  return (
    <>
      <CityFields {...props} />
      <Field invalid={errors.addressDescription !== undefined} disabled={disabled}>
        <FieldLabel htmlFor={addressId}>{t('fields.address.label')}</FieldLabel>
        <Textarea
          id={addressId}
          value={draft.addressDescription}
          onChange={(event) => onChange({ addressDescription: event.currentTarget.value })}
          maxLength={300}
          rows={2}
          disabled={disabled}
        />
        <FieldDescription>{t('fields.address.description')}</FieldDescription>
        <FieldError match={errors.addressDescription !== undefined}>
          {t(`validation.${errors.addressDescription ?? 'addressRequired'}`)}
        </FieldError>
      </Field>
      <PinField
        // Shows the pin again when the draft changes from outside (discard, a reload on conflict).
        key={draft.location ? formatCoordinates(draft.location) : ''}
        value={draft.location}
        onChange={(location) => onChange({ location })}
        invalid={errors.location !== undefined}
        disabled={disabled}
      />
      <PhoneFields
        phones={draft.phones}
        onChange={(phones) => onChange({ phones })}
        errors={errors}
        disabled={props.phonesDisabled}
      />
    </>
  );
}

/**
 * Governorate, then city, from the platform's list. A city archived after the branch chose it is
 * not offered any more, but the branch keeps it (edge case 7).
 */
function CityFields({ draft, onChange, errors, disabled }: FieldsProps) {
  const { t } = useTranslation(['restaurant', 'common']);
  const cities = useQuery(citiesQuery);
  const chosen = cities.data?.find((governorate) =>
    governorate.cities.some((city) => city.id === draft.cityId),
  );
  const [governorateId, setGovernorateId] = useState<string | undefined>();
  const currentGovernorate = governorateId ?? chosen?.id;
  const governorate = cities.data?.find((item) => item.id === currentGovernorate);
  const keptCity = draft.cityId !== undefined && cities.data !== undefined && !chosen;
  const cityItems = [
    ...(governorate?.cities ?? []).map((city) => ({ value: city.id, label: city.nameAr })),
    ...(keptCity && draft.cityId ? [{ value: draft.cityId, label: t('fields.city.kept') }] : []),
  ];

  if (!cities.data) {
    return cities.isError ? (
      <Callout
        role="alert"
        tone="danger"
        title={t('fields.city.loadFailed')}
        action={
          <Button variant="outline" size="sm" onClick={() => void cities.refetch()}>
            {t('common:retry')}
          </Button>
        }
      />
    ) : (
      <Skeleton className="h-16" />
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field disabled={disabled}>
        <FieldLabel render={<span />}>{t('fields.governorate.label')}</FieldLabel>
        <Select
          value={currentGovernorate ?? null}
          onValueChange={(id) => {
            if (!id || id === currentGovernorate) return;
            setGovernorateId(id);
            onChange({ cityId: undefined });
          }}
          items={cities.data.map((item) => ({ value: item.id, label: item.nameAr }))}
          disabled={disabled}
        >
          <SelectTrigger aria-label={t('fields.governorate.label')}>
            <SelectValue placeholder={t('fields.governorate.placeholder')} />
          </SelectTrigger>
          <SelectContent>
            {cities.data.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.nameAr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field invalid={errors.cityId !== undefined} disabled={disabled}>
        <FieldLabel render={<span />}>{t('fields.city.label')}</FieldLabel>
        <Select
          value={draft.cityId ?? null}
          onValueChange={(cityId) => cityId && onChange({ cityId })}
          items={cityItems}
          disabled={disabled || (!governorate && !keptCity)}
        >
          <SelectTrigger
            aria-label={t('fields.city.label')}
            aria-invalid={errors.cityId !== undefined}
          >
            <SelectValue placeholder={t('fields.city.placeholder')} />
          </SelectTrigger>
          <SelectContent>
            {cityItems.map((city) => (
              <SelectItem key={city.value} value={city.value}>
                {city.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError match={errors.cityId !== undefined}>{t('validation.cityRequired')}</FieldError>
      </Field>
    </div>
  );
}

/** Degrees × 10⁷ as text, without floating point: `36.5866` from 365866000. */
function degrees(e7: number): string {
  const sign = e7 < 0 ? '-' : '';
  const units = Math.abs(e7);
  const fraction = String(units % 10_000_000)
    .padStart(7, '0')
    .replace(/0+$/, '');
  return `${sign}${Math.trunc(units / 10_000_000)}${fraction ? `.${fraction}` : ''}`;
}

export function formatCoordinates({ latitudeE7, longitudeE7 }: Coordinates): string {
  return `${degrees(latitudeE7)}, ${degrees(longitudeE7)}`;
}

/** Whether pasted text is a link the server may resolve (rule 20): only the allowed map hosts. */
function mapLinkHost(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:') && isMapLinkHost(url.hostname);
  } catch {
    return false;
  }
}

/**
 * The pin (rule 20): pasted `latitude, longitude` is read here; a Google Maps or OpenStreetMap
 * link goes to the server's resolver. A point outside Syria and Turkey asks for confirmation. The
 * map picker joins when the map tiles are served (ADR 0021, hosting Q1).
 */
function PinField({
  value,
  onChange,
  invalid,
  disabled,
}: {
  value: Coordinates | null;
  onChange: (location: Coordinates) => void;
  invalid: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation(['restaurant', 'errors']);
  const errorText = useErrorText();
  const id = useId();
  const [text, setText] = useState(value ? formatCoordinates(value) : '');
  const [problem, setProblem] = useState<string>();
  const [outside, setOutside] = useState<Coordinates>();
  const [resolving, setResolving] = useState(false);

  function place(point: Coordinates) {
    setText(formatCoordinates(point));
    if (isInServiceRegion(point)) {
      setOutside(undefined);
      onChange(point);
    } else {
      setOutside(point);
    }
  }

  async function read() {
    const typed = text.trim();
    if (!typed || (value && typed === formatCoordinates(value))) return;
    setProblem(undefined);
    const point = parseCoordinatesText(typed);
    if (point) {
      place(point);
      return;
    }
    if (!mapLinkHost(typed)) {
      setProblem(t('errors:MAP_LINK_UNRECOGNIZED'));
      return;
    }
    setResolving(true);
    try {
      place(await resolveMapLink(typed));
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setResolving(false);
    }
  }

  const message = problem ?? (invalid && !outside ? t('validation.locationRequired') : undefined);
  return (
    <Field invalid={message !== undefined} disabled={disabled}>
      <FieldLabel htmlFor={id}>{t('fields.location.label')}</FieldLabel>
      <div className="relative">
        <Input
          id={id}
          dir="ltr"
          value={text}
          placeholder={t('fields.location.placeholder')}
          disabled={disabled}
          readOnly={resolving}
          onChange={(event) => setText(event.currentTarget.value)}
          onBlur={() => void read()}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            // Read the pin before the form moves on (`Form` leaves a handled Enter alone).
            event.preventDefault();
            void read();
          }}
        />
        {resolving && (
          <Loader2
            aria-label={t('fields.location.resolving')}
            className="absolute end-2 top-2 size-5 animate-spin text-muted-foreground"
          />
        )}
      </div>
      <FieldDescription>{t('fields.location.description')}</FieldDescription>
      {outside && (
        <Callout
          role="alert"
          tone="warning"
          icon={<TriangleAlert aria-hidden />}
          title={t('fields.location.outside')}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onChange(outside);
                setOutside(undefined);
              }}
            >
              {t('fields.location.confirmOutside')}
            </Button>
          }
        />
      )}
      <FieldError match={message !== undefined}>{message}</FieldError>
    </Field>
  );
}

/** One to three phones; WhatsApp only on a mobile number. */
function PhoneFields({
  phones,
  onChange,
  errors,
  disabled,
}: {
  phones: PhoneDraft[];
  onChange: (phones: PhoneDraft[]) => void;
  errors: FieldErrors;
  disabled: boolean;
}) {
  const { t } = useTranslation('restaurant');
  const update = (index: number, patch: Partial<PhoneDraft>) =>
    onChange(phones.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
  return (
    <FieldGroup
      legend={t('fields.phones.label')}
      description={t('fields.phones.description')}
      error={errors.phones ? t(`validation.${errors.phones}`) : undefined}
      disabled={disabled}
    >
      <ul className="flex flex-col gap-3">
        {phones.map((entry, index) => {
          const error = errors[`phones.${index}`];
          const number = index + 1;
          return (
            // A row has no identity of its own; its place is its name ("phone 2").
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place, never reordered.
            <li key={index} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  dir="ltr"
                  inputMode="tel"
                  aria-label={t('fields.phones.phone', { number })}
                  aria-invalid={error !== undefined}
                  className="max-w-56"
                  value={entry.phone}
                  disabled={disabled}
                  onChange={(event) => update(index, { phone: event.currentTarget.value })}
                />
                {canHaveWhatsapp(entry.phone) && (
                  // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's switch renders the control inside the label.
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={entry.whatsapp}
                      onCheckedChange={(whatsapp) => update(index, { whatsapp })}
                      disabled={disabled}
                    />
                    {t('fields.phones.whatsapp')}
                  </label>
                )}
                {phones.length > 1 && (
                  <IconButton
                    label={t('fields.phones.remove', { number })}
                    disabled={disabled}
                    onClick={() => onChange(phones.filter((_, at) => at !== index))}
                  >
                    <Trash2 />
                  </IconButton>
                )}
              </div>
              {error && <p className="text-sm text-destructive-text">{t(`validation.${error}`)}</p>}
            </li>
          );
        })}
      </ul>
      {canAddPhone(phones) && (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={disabled}
          onClick={() => onChange([...phones, { phone: '', whatsapp: false }])}
        >
          <Plus aria-hidden />
          {t('fields.phones.add')}
        </Button>
      )}
    </FieldGroup>
  );
}
