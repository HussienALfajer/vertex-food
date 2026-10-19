import { useMutation, useQuery } from '@tanstack/react-query';
import {
  type CurrencyCode,
  currencies,
  type FilePurpose,
  imageUploadRules,
  type Tenant,
  type UpdateTenant,
} from '@vertex-food/contracts';
import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@vertex-food/ui';
import { ImageOff } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldGroup } from '../../components/field-group';
import { useErrorText } from '../../lib/error-text';
import type { FieldErrors } from './branch-draft';
import { imageQuery, removeImage, replaceImage, useSetupCache } from './queries';

export type ProfileDraft = { nameAr: string; nameLatin: string; defaultCurrency: CurrencyCode };

export function profileDraft(tenant: Tenant): ProfileDraft {
  return {
    nameAr: tenant.nameAr,
    nameLatin: tenant.nameLatin ?? '',
    defaultCurrency: tenant.defaultCurrency,
  };
}

const LATIN_NAME = /^[A-Za-z0-9 &'.-]+$/;

export function profileErrors(draft: ProfileDraft): FieldErrors {
  const errors: FieldErrors = {};
  const nameAr = draft.nameAr.trim();
  if (nameAr.length < 2 || nameAr.length > 100) errors.nameAr = 'nameArRequired';
  const nameLatin = draft.nameLatin.trim();
  if (
    nameLatin &&
    (nameLatin.length < 2 || nameLatin.length > 100 || !LATIN_NAME.test(nameLatin))
  ) {
    errors.nameLatin = 'nameLatinInvalid';
  }
  return errors;
}

/**
 * Whether the tenant read back after an image change holds the profile values the form started
 * from. An image moves the tenant's `updatedAt` without returning it; the form may adopt the new
 * one only when nothing else changed meanwhile (rule 16).
 */
export function sameProfile(base: Tenant, fresh: Tenant): boolean {
  const a = profileDraft(base);
  const b = profileDraft(fresh);
  return (
    a.nameAr === b.nameAr && a.nameLatin === b.nameLatin && a.defaultCurrency === b.defaultCurrency
  );
}

export function profileInput(draft: ProfileDraft, updatedAt: string): UpdateTenant {
  return {
    nameAr: draft.nameAr.trim(),
    nameLatin: draft.nameLatin.trim() || null,
    defaultCurrency: draft.defaultCurrency,
    updatedAt,
  };
}

export const currencyCodes = Object.keys(currencies) as CurrencyCode[];

/**
 * The restaurant's names; with `withCurrency`, the default currency of new branches (shown to
 * multi-branch restaurants only: rule 17 keeps "branch" from a single-branch one).
 */
export function ProfileFields({
  draft,
  onChange,
  errors,
  disabled,
  withCurrency,
}: {
  draft: ProfileDraft;
  onChange: (next: (current: ProfileDraft) => ProfileDraft) => void;
  errors: FieldErrors;
  disabled: boolean;
  withCurrency: boolean;
}) {
  const { t } = useTranslation('restaurant');
  const nameArId = useId();
  const nameLatinId = useId();
  return (
    <>
      <Field invalid={errors.nameAr !== undefined} disabled={disabled}>
        <FieldLabel htmlFor={nameArId}>{t('fields.nameAr.label')}</FieldLabel>
        <Input
          id={nameArId}
          value={draft.nameAr}
          maxLength={100}
          onChange={(event) => {
            const nameAr = event.currentTarget.value;
            onChange((current) => ({ ...current, nameAr }));
          }}
        />
        <FieldError match={errors.nameAr !== undefined}>
          {t(`validation.${errors.nameAr ?? 'nameArRequired'}`)}
        </FieldError>
      </Field>
      <Field invalid={errors.nameLatin !== undefined} disabled={disabled}>
        <FieldLabel htmlFor={nameLatinId}>{t('fields.nameLatin.label')}</FieldLabel>
        <Input
          id={nameLatinId}
          dir="ltr"
          value={draft.nameLatin}
          maxLength={100}
          onChange={(event) => {
            const nameLatin = event.currentTarget.value;
            onChange((current) => ({ ...current, nameLatin }));
          }}
        />
        <FieldDescription>{t('fields.nameLatin.description')}</FieldDescription>
        <FieldError match={errors.nameLatin !== undefined}>
          {t('validation.nameLatinInvalid')}
        </FieldError>
      </Field>
      {withCurrency && (
        <Field disabled={disabled}>
          <FieldLabel>{t('fields.tenantCurrency.label')}</FieldLabel>
          <Select
            value={draft.defaultCurrency}
            onValueChange={(code) => {
              if (code) onChange((current) => ({ ...current, defaultCurrency: code }));
            }}
            items={currencyCodes.map((code) => ({ value: code, label: t(`currencies.${code}`) }))}
            disabled={disabled}
          >
            <SelectTrigger className="sm:max-w-xs">
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
          <FieldDescription>{t('fields.tenantCurrency.description')}</FieldDescription>
        </Field>
      )}
    </>
  );
}

/**
 * The logo or the cover: uploaded or removed at once, outside the form's save (rule 19). The
 * server re-encodes it; the preview shows the stored image. Each change moves the tenant's
 * `updatedAt`, so `onChanged` lets the form pick up the new one.
 */
export function ImageField({
  purpose,
  fileId,
  disabled,
  onChanged,
}: {
  purpose: FilePurpose;
  fileId: string | null;
  disabled: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation('restaurant');
  const errorText = useErrorText();
  const cache = useSetupCache();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string>();
  const image = useQuery({ ...imageQuery(fileId ?? ''), enabled: fileId !== null });
  const rules = imageUploadRules[purpose];

  const change = useMutation({
    mutationFn: async (file: File | null) => {
      if (file) await replaceImage(purpose, file);
      else await removeImage(purpose);
      await onChanged();
    },
    onMutate: () => setProblem(undefined),
    onError: (error) => {
      setProblem(errorText(error));
      void cache.refused(error);
    },
  });

  function picked(file: File | undefined) {
    if (!file) return;
    // Checked here for a quick answer; the server checks again and decodes (rule 19).
    if (
      !(rules.acceptedTypes as readonly string[]).includes(file.type) ||
      file.size > rules.maxUploadBytes
    ) {
      setProblem(t(`fields.${purpose}.rejected`));
      return;
    }
    change.mutate(file);
  }

  const preview =
    purpose === 'logo' ? 'size-24 object-contain' : 'aspect-[8/3] w-full max-w-md object-cover';
  return (
    <FieldGroup
      legend={t(`fields.${purpose}.label`)}
      description={t(`fields.${purpose}.description`)}
      error={problem}
      disabled={disabled || change.isPending}
    >
      <div className="flex flex-wrap items-center gap-4">
        {fileId === null ? (
          <span
            className={`flex items-center justify-center rounded-md border border-dashed border-border text-muted-foreground ${purpose === 'logo' ? 'size-24' : 'aspect-[8/3] w-full max-w-md'}`}
          >
            <ImageOff aria-hidden className="size-6" />
            <span className="sr-only">{t(`fields.${purpose}.none`)}</span>
          </span>
        ) : image.data ? (
          <img
            src={image.data}
            alt={t(`fields.${purpose}.alt`)}
            className={`rounded-md border border-border bg-muted ${preview}`}
          />
        ) : (
          <Skeleton className={purpose === 'logo' ? 'size-24' : 'aspect-[8/3] w-full max-w-md'} />
        )}
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept={rules.acceptedTypes.join(',')}
            // Opened by the button below; hidden from assistive technology so it is one control.
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            data-purpose={purpose}
            onChange={(event) => {
              picked(event.currentTarget.files?.[0]);
              event.currentTarget.value = '';
            }}
          />
          <Button
            variant="outline"
            loading={change.isPending && change.variables !== null}
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            {fileId ? t(`fields.${purpose}.replace`) : t(`fields.${purpose}.upload`)}
          </Button>
          {fileId && (
            <Button
              variant="ghost"
              loading={change.isPending && change.variables === null}
              disabled={disabled}
              onClick={() => change.mutate(null)}
            >
              {t(`fields.${purpose}.remove`)}
            </Button>
          )}
        </div>
      </div>
    </FieldGroup>
  );
}
