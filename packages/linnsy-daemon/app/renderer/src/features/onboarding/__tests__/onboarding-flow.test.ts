import { describe, expect, it } from 'vitest';

import {
  getInitialFrontendRoute,
  getNextOnboardingRoute,
  onboardingSteps
} from '../onboarding-flow.js';

describe('onboarding flow', () => {
  it('starts first-run users at the welcome step', () => {
    expect(getInitialFrontendRoute({ hasConfig: false, onboardingDone: false })).toBe(
      '/onboarding/welcome'
    );
  });

  it('sends configured users to the chat shell', () => {
    expect(getInitialFrontendRoute({ hasConfig: true, onboardingDone: true })).toBe('/chat');
  });

  it('keeps the six onboarding steps in route order', () => {
    expect(onboardingSteps.map((step) => step.route)).toEqual([
      '/onboarding/welcome',
      '/onboarding/provider',
      '/onboarding/api-key',
      '/onboarding/channels',
      '/onboarding/do-not-disturb',
      '/onboarding/done'
    ]);
    expect(getNextOnboardingRoute('/onboarding/api-key')).toBe('/onboarding/channels');
  });
});
