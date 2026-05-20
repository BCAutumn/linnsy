import type { I18nKey } from '../../lib/i18n.js';

export interface OnboardingStep {
  route: string;
  labelKey: I18nKey;
}

export interface FrontendRouteState {
  hasConfig: boolean;
  onboardingDone: boolean;
}

export const onboardingSteps: [OnboardingStep, ...OnboardingStep[]] = [
  { route: '/onboarding/welcome', labelKey: 'onboardingWelcomeStep' },
  { route: '/onboarding/provider', labelKey: 'onboardingProviderStep' },
  { route: '/onboarding/api-key', labelKey: 'onboardingApiKeyStep' },
  { route: '/onboarding/channels', labelKey: 'onboardingChannelsStep' },
  { route: '/onboarding/do-not-disturb', labelKey: 'onboardingDoNotDisturbStep' },
  { route: '/onboarding/done', labelKey: 'onboardingDoneStep' }
];

const firstOnboardingStep = onboardingSteps[0];

export function getInitialFrontendRoute(state: FrontendRouteState): string {
  return state.hasConfig && state.onboardingDone ? '/chat' : firstOnboardingStep.route;
}

export function getNextOnboardingRoute(route: string): string {
  const index = onboardingSteps.findIndex((step) => step.route === route);
  if (index === -1) {
    return firstOnboardingStep.route;
  }
  const next = onboardingSteps[Math.min(index + 1, onboardingSteps.length - 1)];
  return next?.route ?? firstOnboardingStep.route;
}
