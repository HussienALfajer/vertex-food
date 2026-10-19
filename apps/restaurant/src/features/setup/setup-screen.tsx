import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { BranchDetail } from '@vertex-food/contracts';
import { Button } from '@vertex-food/ui';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryStates } from '../../components/query-states';
import { StateCard } from '../../components/state-card';
import { branchesQuery, branchQuery, citiesQuery } from '../tenancy/queries';
import { useTenant } from '../tenancy/tenant-gate';
import { resumeStep } from './setup-steps';
import { SetupWizard } from './setup-wizard';

/**
 * `/setup` for the owner while the restaurant is onboarding (rule 5): the wizard until it is
 * complete, then "waiting for activation". Other staff never reach it (the gate shows them "setup
 * in progress").
 */
export function SetupScreen() {
  const tenant = useTenant();
  return tenant.onboardingCompletedAt ? <WaitingForActivation /> : <SetupLoader />;
}

function WaitingForActivation() {
  const { t } = useTranslation('restaurant');
  return (
    <StateCard
      role="status"
      title={t('setup.waiting.title')}
      description={t('setup.waiting.description')}
      action={
        <Button variant="outline" render={<Link to="/settings/restaurant" />}>
          {t('setup.waiting.action')}
        </Button>
      }
    />
  );
}

/** The wizard starts from what is saved: every branch with its hours and charge lines. */
function SetupLoader() {
  const tenant = useTenant();
  const branches = useQuery(branchesQuery);
  const details = useQueries({
    queries: (branches.data ?? []).map((branch) => branchQuery(branch.id)),
  });
  const cities = useQuery(citiesQuery);
  // The step as first loaded: a later save must not move the owner.
  const start = useRef(resumeStep(tenant));
  return (
    <QueryStates queries={[branches, cities, ...details]}>
      {() => (
        <SetupWizard
          tenant={tenant}
          details={details.map((detail) => detail.data as BranchDetail)}
          initialStep={start.current}
        />
      )}
    </QueryStates>
  );
}
