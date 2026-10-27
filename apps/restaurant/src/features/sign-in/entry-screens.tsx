import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate } from '@tanstack/react-router';
import { deviceNameSchema, type TenantOptions } from '@vertex-food/contracts';
import {
  Button,
  Callout,
  Card,
  Field,
  FieldLabel,
  Form,
  FormActions,
  FormFields,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@vertex-food/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryStates } from '../../components/query-states';
import { StateCard } from '../../components/state-card';
import { api, unwrap } from '../../lib/api';
import { type DeviceBridge, deviceBridge } from '../../lib/device';
import { useOnline } from '../../lib/online';
import { useBridgeErrorText } from '../session/member-picker';
import { SignInFlow, TextField, TICKET_HEADER, useStepAction } from './sign-in-flow';
import { dropTicket, heldTicket, holdTicket } from './ticket';

/**
 * The welcome screen (spec S02 screen 1): on an unregistered PC, "Register this PC" for an owner
 * or manager; in a browser, "Sign in" from a personal device (rule 34).
 */
export function WelcomeScreen() {
  const { t } = useTranslation('restaurant');
  return (
    <StateCard
      title={t('welcome.title')}
      description={deviceBridge ? t('welcome.deviceDescription') : t('welcome.browserDescription')}
      action={
        deviceBridge ? (
          <Button render={<Link to="/sign-in" />}>{t('welcome.register')}</Button>
        ) : (
          <Button render={<Link to="/sign-in" />}>{t('welcome.signIn')}</Button>
        )
      }
    />
  );
}

function tenantOptionsQuery(ticket: string) {
  return {
    queryKey: ['tenant-options', ticket],
    queryFn: () =>
      unwrap(api.GET('/api/auth/tenant-options', { headers: { [TICKET_HEADER]: ticket } })),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  };
}

/**
 * Sign-in (screen 2). On a PC it leads to registering it (screen 3); in a browser to the tenant
 * choice and the personal session (rule 34).
 */
export function SignInScreen() {
  const { t } = useTranslation('restaurant');
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<string | null>(null);
  const intent = deviceBridge ? 'register_device' : 'personal';
  return (
    <section className="flex max-w-xl flex-col gap-6">
      <PageHeader
        title={deviceBridge ? t('register.title') : t('signIn.title')}
        description={
          deviceBridge ? t('signIn.registerDescription') : t('signIn.personalDescription')
        }
      />
      <Card className="p-4 sm:p-6">
        {ticket ? (
          <PersonalTenantStep ticket={ticket} onRestart={() => setTicket(null)} />
        ) : (
          <SignInFlow
            intent={intent}
            onSignedIn={async (signedIn) => {
              if (deviceBridge) {
                holdTicket(signedIn);
                await navigate({ to: '/register' });
              } else {
                setTicket(signedIn);
              }
            }}
          />
        )}
      </Card>
    </section>
  );
}

/** Rule 34: the tenants where the person holds `backoffice.remote`; one is chosen at once. */
function PersonalTenantStep({ ticket, onRestart }: { ticket: string; onRestart: () => void }) {
  const { t } = useTranslation('restaurant');
  const queryClient = useQueryClient();
  const options = useQuery(tenantOptionsQuery(ticket));
  const { busy, error, run } = useStepAction();

  const open = (tenantId: string) =>
    run(async () => {
      await unwrap(
        api.POST('/api/auth/personal-session', {
          body: { tenantId },
          headers: { [TICKET_HEADER]: ticket },
        }),
      );
      // The session gate reads the session and opens the app.
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    });

  const tenants = options.data?.tenants ?? [];
  const onlyId = tenants.length === 1 ? tenants[0]?.tenantId : undefined;
  // One tenant: it opens at once, once (the ticket is single use, StrictMode runs effects twice).
  const opened = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: opens once the options arrive.
  useEffect(() => {
    if (!onlyId || opened.current) return;
    opened.current = true;
    void open(onlyId);
  }, [onlyId]);

  return (
    <QueryStates queries={[options]}>
      {() => (
        <div className="flex flex-col gap-4">
          {error && <Callout role="alert" tone="danger" title={error} />}
          {tenants.length === 0 ? (
            <>
              <p className="text-sm text-muted-foreground">{t('signIn.noTenants')}</p>
              <Button type="button" variant="secondary" onClick={onRestart}>
                {t('signIn.backToSignIn')}
              </Button>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold text-foreground">{t('signIn.tenantTitle')}</h2>
                <p className="text-sm text-muted-foreground">{t('signIn.tenantDescription')}</p>
              </div>
              <ul className="flex flex-col gap-3">
                {tenants.map((tenant) => (
                  <li key={tenant.tenantId}>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full justify-start"
                      loading={busy}
                      onClick={() => void open(tenant.tenantId)}
                    >
                      {tenant.nameAr}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </QueryStates>
  );
}

/**
 * Register this PC (spec S02 screen 3, rules 16–18): the tenant (skipped with one), the branch
 * (skipped with one), the PC's name. The main process makes the device key and opens the
 * registering member's session; the session gate then asks for their PIN.
 */
export function RegisterScreen() {
  const { t } = useTranslation('restaurant');
  const ticket = heldTicket();
  if (!deviceBridge) return <Navigate to="/welcome" replace />;
  return (
    <section className="flex max-w-xl flex-col gap-6">
      <PageHeader title={t('register.title')} description={t('register.description')} />
      <Card className="p-4 sm:p-6">
        {ticket ? <RegisterForm bridge={deviceBridge} ticket={ticket} /> : <Expired />}
      </Card>
    </section>
  );
}

function Expired() {
  const { t } = useTranslation('restaurant');
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('register.expired')}</p>
      <Button render={<Link to="/sign-in" />}>{t('signIn.title')}</Button>
    </div>
  );
}

function RegisterForm({ bridge, ticket }: { bridge: DeviceBridge; ticket: string }) {
  const { t } = useTranslation('restaurant');
  const online = useOnline();
  const bridgeErrorText = useBridgeErrorText();
  const options = useQuery(tenantOptionsQuery(ticket));
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  if (expired) return <Expired />;
  return (
    <QueryStates queries={[options]}>
      {() => {
        const { tenants } = options.data as TenantOptions;
        if (tenants.length === 0) {
          return <p className="text-sm text-muted-foreground">{t('signIn.noTenants')}</p>;
        }
        const tenant =
          tenants.find((item) => item.tenantId === tenantId) ??
          (tenants.length === 1 ? tenants[0] : undefined);
        const branches = tenant?.branches ?? [];
        const branch =
          branches.find((item) => item.id === branchId) ??
          (branches.length === 1 ? branches[0] : undefined);
        const nameValid = deviceNameSchema.safeParse(name).success;

        const submit = () => {
          setChecked(true);
          if (!(tenant && branch && nameValid)) return false;
          setBusy(true);
          setError(null);
          void bridge
            .register({ ticket, tenantId: tenant.tenantId, branchId: branch.id, name: name.trim() })
            // The main process failing outright (IPC refused) is a refusal like any other.
            .catch(() => ({ ok: false as const, code: 'INTERNAL_ERROR' }))
            .then((result) => {
              setBusy(false);
              if (result.ok) {
                dropTicket();
              } else if (result.code === 'TICKET_INVALID') {
                dropTicket();
                setExpired(true);
              } else {
                setError(bridgeErrorText(result));
              }
            });
          return true;
        };

        return (
          <Form onSubmit={submit} busy={busy} className="flex flex-col gap-4">
            {error && <Callout role="alert" tone="danger" title={error} />}
            <FormFields>
              {tenants.length > 1 && (
                <Field invalid={checked && !tenant}>
                  <FieldLabel>{t('register.tenant')}</FieldLabel>
                  <Select
                    value={tenant?.tenantId ?? null}
                    onValueChange={(value) => {
                      setTenantId(value);
                      setBranchId(null);
                    }}
                    items={tenants.map((item) => ({ value: item.tenantId, label: item.nameAr }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {tenants.map((item) => (
                        <SelectItem key={item.tenantId} value={item.tenantId}>
                          {item.nameAr}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {branches.length > 1 && (
                <Field invalid={checked && !branch}>
                  <FieldLabel>{t('register.branch')}</FieldLabel>
                  <Select
                    value={branch?.id ?? null}
                    onValueChange={setBranchId}
                    items={branches.map((item) => ({ value: item.id, label: item.nameAr }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.nameAr}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <TextField
                label={t('register.name')}
                description={t('register.nameHint')}
                maxLength={50}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                error={checked && !nameValid ? t('register.nameInvalid') : undefined}
              />
            </FormFields>
            <FormActions>
              <Button type="submit" loading={busy} disabled={!online}>
                {t('register.submit')}
              </Button>
            </FormActions>
          </Form>
        );
      }}
    </QueryStates>
  );
}
