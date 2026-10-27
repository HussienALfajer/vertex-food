import { useMutation, useQuery } from '@tanstack/react-query';
import {
  type ConsolePermission,
  type ConsoleRole,
  consolePermissions,
  consoleRoles,
  mobilePhoneNumberSchema,
  type PlatformUser,
  type PlatformUserSetup,
  platformUserNameSchema,
} from '@vertex-food/contracts';
import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Field,
  FieldDescription,
  FieldLabel,
  Form,
  FormFields,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@vertex-food/ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OfflineNotice } from '../../components/offline-notice';
import { QueryStates } from '../../components/query-states';
import { StateCard } from '../../components/state-card';
import { TextField } from '../../components/text-field';
import { useErrorText } from '../../lib/error-text';
import { formatDateTime } from '../../lib/format';
import { useOnline } from '../../lib/online';
import { useReauth } from '../session/reauth';
import { holds, meQuery } from '../session/session';
import {
  type AccessDraft,
  accessChange,
  accessDraft,
  permissionState,
  sameAccess,
  withRole,
} from './access-draft';
import {
  createPlatformUser,
  platformUsersQuery,
  resetPlatformUser,
  updatePlatformUser,
  usePlatformUsersCache,
} from './queries';

/**
 * `/platform-users` (screen 16, rules 38 and 42), for `console.users.manage`: Vertex staff in the
 * console; add a user (setup code shown once), change a role and its adjustments, disable or
 * enable, reset the sign-in. Every change asks for a TOTP first (rule 40). An admin cannot change
 * themselves; the API keeps the last active admin (`LAST_ADMIN`).
 */
export function PlatformUsersScreen() {
  const { t } = useTranslation('console');
  const me = useQuery(meQuery);
  const manager = holds(me.data, 'console.users.manage');
  const users = useQuery({ ...platformUsersQuery, enabled: manager });
  const online = useOnline();
  const [setup, setSetup] = useState<PlatformUserSetup>();
  if (me.data && !manager) {
    return (
      <StateCard
        role="status"
        title={t('states.noAccessTitle')}
        description={t('states.noAccessDescription')}
      />
    );
  }
  return (
    <section className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={t('platformUsers.title')}
        description={t('platformUsers.description')}
        actions={<CreateDialog disabled={!online} onCreated={setSetup} />}
      />
      <OfflineNotice />
      <QueryStates queries={[me, users]}>
        {() =>
          users.data?.length ? (
            <ul aria-label={t('platformUsers.listLabel')} className="flex flex-col gap-4">
              {users.data.map((user) => (
                <UserCard
                  key={user.id}
                  user={user}
                  self={user.id === me.data?.id}
                  disabled={!online}
                  onReset={setSetup}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              title={t('platformUsers.empty.title')}
              description={t('platformUsers.empty.description')}
            />
          )
        }
      </QueryStates>
      <SetupCodeDialog setup={setup} onClose={() => setSetup(undefined)} />
    </section>
  );
}

const statusTone = { pending_setup: 'warning', active: 'success', disabled: 'neutral' } as const;

function UserCard({
  user,
  self,
  disabled,
  onReset,
}: {
  user: PlatformUser;
  self: boolean;
  disabled: boolean;
  onReset: (setup: PlatformUserSetup) => void;
}) {
  const { t } = useTranslation('console');
  const expires = user.setupCodeExpiresAt;
  return (
    <li aria-label={user.name}>
      <Card className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 text-lg font-semibold wrap-anywhere">{user.name}</h2>
          {self && <Badge tone="brand">{t('platformUsers.you')}</Badge>}
          <Badge tone={statusTone[user.status]}>{t(`platformUsers.statuses.${user.status}`)}</Badge>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t('platformUsers.phone')}</dt>
            <dd>
              <bdi dir="ltr">{user.phone}</bdi>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t('platformUsers.role')}</dt>
            <dd>{t(`roles.${user.role}`)}</dd>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <dt className="text-muted-foreground">{t('platformUsers.permissions')}</dt>
            <dd>
              {user.effectivePermissions.length
                ? user.effectivePermissions
                    .map((permission) => t(`permissions.${permission}`))
                    .join('، ')
                : t('platformUsers.noPermissions')}
            </dd>
          </div>
        </dl>
        {user.status === 'pending_setup' && expires && (
          <p className="text-sm text-muted-foreground">
            {Date.parse(expires) > Date.now()
              ? t('platformUsers.setupUntil', { date: formatDateTime(expires) })
              : t('platformUsers.setupExpired')}
          </p>
        )}
        {/* Rule 42: an admin never demotes, disables or resets themselves. */}
        {!self && (
          <div className="flex flex-wrap gap-2">
            {user.status !== 'disabled' && <AccessDialog user={user} disabled={disabled} />}
            <StatusAction user={user} disabled={disabled} />
            {user.status !== 'disabled' && (
              <ResetAction user={user} disabled={disabled} onReset={onReset} />
            )}
          </div>
        )}
      </Card>
    </li>
  );
}

/** A dialog holding a small form: reset each time it opens, kept open while its save runs. */
function FormDialog({
  trigger,
  title,
  description,
  busy,
  onOpen,
  open,
  setOpen,
  onSubmit,
  actions,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description?: string;
  busy: boolean;
  onOpen: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSubmit: () => boolean;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) onOpen();
        setOpen(next);
      }}
    >
      {trigger}
      <DialogContent>
        <Form onSubmit={onSubmit} busy={busy} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </div>
          {children}
          <DialogActions>{actions}</DialogActions>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function RoleChoice({
  value,
  onChange,
}: {
  value: ConsoleRole;
  onChange: (role: ConsoleRole) => void;
}) {
  const { t } = useTranslation('console');
  return (
    <Field>
      <FieldLabel>{t('platformUsers.role')}</FieldLabel>
      <Select
        value={value}
        onValueChange={(next) => next && onChange(next)}
        items={consoleRoles.map((role) => ({ value: role, label: t(`roles.${role}`) }))}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {consoleRoles.map((role) => (
            <SelectItem key={role} value={role}>
              {t(`roles.${role}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>{t(`roleDescriptions.${value}`)}</FieldDescription>
    </Field>
  );
}

function CreateDialog({
  disabled,
  onCreated,
}: {
  disabled: boolean;
  onCreated: (setup: PlatformUserSetup) => void;
}) {
  const { t } = useTranslation('console');
  const errorText = useErrorText();
  const withReauth = useReauth();
  const changed = usePlatformUsersCache();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<ConsoleRole>('support');
  const [checking, setChecking] = useState(false);
  const parsedPhone = mobilePhoneNumberSchema.safeParse(phone);
  const parsedName = platformUserNameSchema.safeParse(name);

  const create = useMutation({
    // The answer holds the setup code, shown once (rule 38).
    gcTime: 0,
    mutationFn: (input: { phone: string; name: string }) =>
      withReauth(() =>
        createPlatformUser({ ...input, role, grantedPermissions: [], revokedPermissions: [] }),
      ),
    onSuccess: async (setup) => {
      setOpen(false);
      onCreated(setup);
      await changed(setup.user);
    },
  });

  return (
    <FormDialog
      trigger={
        <DialogTrigger render={<Button disabled={disabled} />}>
          {t('platformUsers.create')}
        </DialogTrigger>
      }
      title={t('platformUsers.createDialog.title')}
      description={t('platformUsers.createDialog.description')}
      busy={create.isPending}
      open={open}
      setOpen={setOpen}
      onOpen={() => {
        setPhone('');
        setName('');
        setRole('support');
        setChecking(false);
        create.reset();
      }}
      onSubmit={() => {
        setChecking(true);
        if (!parsedPhone.success || !parsedName.success) return false;
        create.mutate({ phone: parsedPhone.data, name: parsedName.data });
        return true;
      }}
      actions={
        <>
          <Button type="submit" loading={create.isPending}>
            {t('platformUsers.createDialog.submit')}
          </Button>
          <DialogClose
            render={<Button type="button" variant="outline" disabled={create.isPending} />}
          >
            {t('platformUsers.back')}
          </DialogClose>
        </>
      }
    >
      <FormFields>
        <TextField
          label={t('platformUsers.name')}
          error={
            checking && !parsedName.success
              ? t('platformUsers.createDialog.nameInvalid')
              : undefined
          }
          autoComplete="off"
          maxLength={100}
          value={name}
          onValueChange={setName}
        />
        <TextField
          label={t('platformUsers.phone')}
          description={t('signIn.phoneHint')}
          error={checking && !parsedPhone.success ? t('signIn.phoneInvalid') : undefined}
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="off"
          value={phone}
          onValueChange={setPhone}
        />
        <RoleChoice value={role} onChange={setRole} />
      </FormFields>
      {create.error && <Callout role="alert" tone="danger" title={errorText(create.error)} />}
    </FormDialog>
  );
}

/**
 * The role and its adjustments (rule 42): each permission the role may hold shows whether it comes
 * from the role, was added or was removed; the others are disabled and say why.
 */
function PermissionChoices({
  draft,
  onChange,
}: {
  draft: AccessDraft;
  onChange: (draft: AccessDraft) => void;
}) {
  const { t } = useTranslation('console');
  const toggle = (permission: ConsolePermission, on: boolean) => {
    const held = new Set(draft.held);
    if (on) held.add(permission);
    else held.delete(permission);
    onChange({ ...draft, held });
  };
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-sm font-medium">{t('platformUsers.permissions')}</legend>
      {consolePermissions.map((permission) => {
        const state = permissionState(draft, permission);
        const outside = state === 'outsideLimits';
        return (
          // biome-ignore lint/a11y/noLabelWithoutControl: the checkbox inside is the control.
          <label
            key={permission}
            className={
              outside
                ? 'flex min-h-11 items-start gap-3 text-base text-muted-foreground'
                : 'flex min-h-11 items-start gap-3 text-base'
            }
          >
            <Checkbox
              className="mt-0.5"
              checked={draft.held.has(permission)}
              disabled={outside}
              onCheckedChange={(on) => toggle(permission, on)}
            />
            <span className="flex flex-col gap-0.5">
              <span>{t(`permissions.${permission}`)}</span>
              <span className="text-sm text-muted-foreground">
                {t(`platformUsers.permissionStates.${state}`)}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function AccessDialog({ user, disabled }: { user: PlatformUser; disabled: boolean }) {
  const { t } = useTranslation('console');
  const errorText = useErrorText();
  const withReauth = useReauth();
  const changed = usePlatformUsersCache();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => accessDraft(user));

  const save = useMutation({
    mutationFn: (next: AccessDraft) =>
      withReauth(() => updatePlatformUser(user.id, accessChange(next))),
    onSuccess: async (saved) => {
      setOpen(false);
      toast.add({ title: t('platformUsers.accessChanged'), type: 'success' });
      await changed(saved);
    },
  });

  return (
    <FormDialog
      trigger={
        <DialogTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}>
          {t('platformUsers.changeAccess')}
        </DialogTrigger>
      }
      title={t('platformUsers.accessDialog.title', { name: user.name })}
      description={t('platformUsers.accessDialog.description')}
      busy={save.isPending}
      open={open}
      setOpen={setOpen}
      onOpen={() => {
        setDraft(accessDraft(user));
        save.reset();
      }}
      onSubmit={() => {
        save.mutate(draft);
        return true;
      }}
      actions={
        <>
          <Button type="submit" loading={save.isPending} disabled={sameAccess(draft, user)}>
            {t('platformUsers.accessDialog.submit')}
          </Button>
          <DialogClose
            render={<Button type="button" variant="outline" disabled={save.isPending} />}
          >
            {t('platformUsers.back')}
          </DialogClose>
        </>
      }
    >
      <FormFields>
        <RoleChoice value={draft.role} onChange={(role) => setDraft(withRole(draft, role))} />
        <PermissionChoices draft={draft} onChange={setDraft} />
      </FormFields>
      {save.error && <Callout role="alert" tone="danger" title={errorText(save.error)} />}
    </FormDialog>
  );
}

/** A confirmation before an action that ends the user's sessions. */
function ConfirmDialog({
  trigger,
  title,
  description,
  confirm,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  confirm: string;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('console');
  return (
    <Dialog>
      {trigger}
      <DialogContent>
        <div className="flex flex-col gap-1">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
        <DialogActions>
          <DialogClose render={<Button type="button" variant="destructive" />} onClick={onConfirm}>
            {confirm}
          </DialogClose>
          <DialogClose render={<Button type="button" variant="outline" />}>
            {t('platformUsers.back')}
          </DialogClose>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

/** Disabling ends the user's sessions (asks first); enabling gives the sign-in back. */
function StatusAction({ user, disabled }: { user: PlatformUser; disabled: boolean }) {
  const { t } = useTranslation('console');
  const errorText = useErrorText();
  const withReauth = useReauth();
  const changed = usePlatformUsersCache();
  const enabling = user.status === 'disabled';
  const change = useMutation({
    mutationFn: () => withReauth(() => updatePlatformUser(user.id, { disabled: !enabling })),
    onSuccess: async (saved) => {
      toast.add({
        title: enabling ? t('platformUsers.enabled') : t('platformUsers.disabled'),
        type: 'success',
      });
      await changed(saved);
    },
    onError: (error) => toast.add({ title: errorText(error), type: 'error' }),
  });
  if (enabling) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        loading={change.isPending}
        onClick={() => change.mutate()}
      >
        {t('platformUsers.enable')}
      </Button>
    );
  }
  return (
    <ConfirmDialog
      trigger={
        <DialogTrigger
          render={
            <Button variant="outline" size="sm" disabled={disabled} loading={change.isPending} />
          }
        >
          {t('platformUsers.disable')}
        </DialogTrigger>
      }
      title={t('platformUsers.disableDialog.title', { name: user.name })}
      description={t('platformUsers.disableDialog.description')}
      confirm={t('platformUsers.disableDialog.confirm')}
      onConfirm={() => change.mutate()}
    />
  );
}

/** Rule 42: a lost TOTP or password is reset by another admin; a new setup code follows. */
function ResetAction({
  user,
  disabled,
  onReset,
}: {
  user: PlatformUser;
  disabled: boolean;
  onReset: (setup: PlatformUserSetup) => void;
}) {
  const { t } = useTranslation('console');
  const errorText = useErrorText();
  const withReauth = useReauth();
  const changed = usePlatformUsersCache();
  const reset = useMutation({
    // The answer holds the new setup code, shown once (rule 38).
    gcTime: 0,
    mutationFn: () => withReauth(() => resetPlatformUser(user.id)),
    onSuccess: async (setup) => {
      onReset(setup);
      await changed(setup.user);
    },
    onError: (error) => toast.add({ title: errorText(error), type: 'error' }),
  });
  return (
    <ConfirmDialog
      trigger={
        <DialogTrigger
          render={
            <Button variant="ghost" size="sm" disabled={disabled} loading={reset.isPending} />
          }
        >
          {t('platformUsers.reset')}
        </DialogTrigger>
      }
      title={t('platformUsers.resetDialog.title', { name: user.name })}
      description={t('platformUsers.resetDialog.description')}
      confirm={t('platformUsers.resetDialog.confirm')}
      onConfirm={() => reset.mutate()}
    />
  );
}

/** Rule 38: the one-time setup code, shown to the admin this once to hand over in person. */
function SetupCodeDialog({
  setup,
  onClose,
}: {
  setup: PlatformUserSetup | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation('console');

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.add({ title: t('platformUsers.setupCodeDialog.copied'), type: 'success' });
    } catch {
      toast.add({ title: t('recoveryCodes.copyFailed'), type: 'error' });
    }
  }

  return (
    <Dialog open={setup !== undefined} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {setup && (
          <>
            <div className="flex flex-col gap-1">
              <DialogTitle>
                {t('platformUsers.setupCodeDialog.title', { name: setup.user.name })}
              </DialogTitle>
              <DialogDescription>
                {t('platformUsers.setupCodeDialog.description')}
              </DialogDescription>
            </div>
            <div className="flex flex-col items-start gap-2">
              <span className="text-sm text-muted-foreground">
                {t('platformUsers.setupCodeDialog.codeLabel')}
              </span>
              <bdi dir="ltr" className="text-2xl font-bold tabular-nums wrap-anywhere select-all">
                {setup.setupCode}
              </bdi>
              <span className="text-sm text-muted-foreground">
                {t('platformUsers.setupCodeDialog.expires', {
                  date: formatDateTime(setup.setupCodeExpiresAt),
                })}
              </span>
            </div>
            <DialogActions>
              <DialogClose render={<Button type="button" />}>
                {t('platformUsers.setupCodeDialog.done')}
              </DialogClose>
              <Button type="button" variant="outline" onClick={() => void copy(setup.setupCode)}>
                {t('platformUsers.setupCodeDialog.copy')}
              </Button>
            </DialogActions>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
