import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { onboardingSteps } from './onboarding-flow.js';
import { t, type Locale } from '../../lib/i18n.js';
import { FluentIcon } from '../../components/FluentIcon.js';
import { TextField } from '../../components/TextField.js';

export function OnboardingView(props: { locale: Locale }): React.JSX.Element {
  const params = useParams();
  const navigate = useNavigate();
  const currentIndex = Math.max(0, onboardingSteps.findIndex((step) => step.route.endsWith(params.step ?? '')));
  const step = onboardingSteps[currentIndex] ?? onboardingSteps[0];
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isLast = currentIndex === onboardingSteps.length - 1;
  const locale = props.locale;

  return (
    <section aria-label={t(locale, 'onboardingAria')} className="onboarding-view">
      <div className="onboarding-card">
        <div className="ob-progress" aria-hidden="true">
          {onboardingSteps.map((item, index) => (
            <span
              className={`ob-step-dot${index === currentIndex ? ' active' : index < currentIndex ? ' done' : ''}`}
              key={item.route}
            />
          ))}
        </div>
        <div className="ob-eyebrow">{t(locale, 'onboardingStep', { step: currentIndex + 1 })}</div>
        <h1 className="ob-title">{t(locale, 'onboardingTitle')}</h1>
        <p className="ob-desc">{t(locale, step.labelKey)}</p>
        <OnboardingStepBody
          apiKey={apiKey}
          currentIndex={currentIndex}
          error={error}
          locale={locale}
          setApiKey={setApiKey}
        />
        <footer className="ob-actions wizard-actions">
          <button
            className="btn"
            disabled={currentIndex === 0}
            onClick={() => {
              navigate(onboardingSteps[currentIndex - 1]?.route ?? '/onboarding/welcome');
            }}
            type="button"
          >
            <FluentIcon aria-hidden="true" name="chevronLeft" size={16} />
            {t(locale, 'onboardingPrevious')}
          </button>
          <button
            className="btn primary"
            onClick={() => {
              if (currentIndex === 2 && apiKey.trim().length < 8) {
                setError(t(locale, 'onboardingApiKeyTooShort'));
                return;
              }
              setError(null);
              if (isLast) {
                navigate('/chat');
                return;
              }
              navigate(onboardingSteps[currentIndex + 1]?.route ?? '/chat');
            }}
            type="button"
          >
            <FluentIcon aria-hidden="true" name={isLast ? 'checkmark' : 'chevronRight'} size={16} />
            {isLast ? t(locale, 'onboardingStartChat') : t(locale, 'onboardingNext')}
          </button>
        </footer>
      </div>
    </section>
  );
}

function OnboardingStepBody(props: {
  apiKey: string;
  currentIndex: number;
  error: string | null;
  locale: Locale;
  setApiKey(value: string): void;
}): React.JSX.Element {
  if (props.currentIndex === 2) {
    return (
      <div className="wizard-panel">
        <TextField
          label={t(props.locale, 'onboardingApiKeyLabel')}
          onValueChange={(value) => {
            props.setApiKey(value);
          }}
          placeholder="sk-..."
          type="password"
          value={props.apiKey}
        />
        {props.error === null ? null : <p className="field-error">{props.error}</p>}
      </div>
    );
  }
  if (props.currentIndex === 3) {
    return <div className="wizard-panel">{t(props.locale, 'onboardingChannelsBody')}</div>;
  }
  if (props.currentIndex === 4) {
    return <div className="wizard-panel">{t(props.locale, 'onboardingDoNotDisturbBody')}</div>;
  }
  return <div className="wizard-panel">{t(props.locale, 'onboardingDefaultBody')}</div>;
}
