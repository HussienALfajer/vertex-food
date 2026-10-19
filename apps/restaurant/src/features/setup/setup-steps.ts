import type { OnboardingItem, Tenant } from '@vertex-food/contracts';

export const setupSteps = ['restaurant', 'location', 'hours', 'money', 'review'] as const;

export type SetupStep = (typeof setupSteps)[number];

/** The step where a missing onboarding item is filled in (rule 3). */
export const stepOfItem: Record<OnboardingItem, SetupStep> = {
  'tenant.name': 'restaurant',
  'branch.city': 'location',
  'branch.address': 'location',
  'branch.location': 'location',
  'branch.phone': 'location',
  'branch.hours': 'hours',
  'branch.currency': 'money',
};

/**
 * Where the owner resumes, on any device (rule 3): the first step for a restaurant nobody has
 * edited yet, otherwise the first step with a missing item, otherwise the review.
 */
export function resumeStep(tenant: Tenant): SetupStep {
  if (tenant.updatedAt === tenant.createdAt) return 'restaurant';
  const [first] = tenant.onboarding.missing;
  return first ? stepOfItem[first.item] : 'review';
}
