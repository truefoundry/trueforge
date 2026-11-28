'use client';

import { useEffect, useState } from 'react';

import { useTrackAnalytics } from '../../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../../analytics/events.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { ConnectMcpStep } from './ConnectMcpStep.js';
import { ConnectModelStep } from './ConnectModelStep.js';

const STEPS = ['model', 'mcp'] as const;
type OnboardingStep = (typeof STEPS)[number];

const STEP_LABELS = ['Connect Model', 'Connect MCPs (optional)'] as const;

export type OnboardingContainerProps = {
  /** Called once the user finishes (or skips) the optional MCP step; a model is already connected by then. */
  onComplete: () => void;
};

/** First-run flow: a mandatory model connection followed by optional MCP connectors. */
export function OnboardingContainer({ onComplete }: OnboardingContainerProps) {
  const Frame = useSlot('OnboardingFrame');
  const Stepper = useSlot('OnboardingStepper');
  const track = useTrackAnalytics();
  const [step, setStep] = useState<OnboardingStep>('model');
  const [connectedType, setConnectedType] = useState<string | undefined>(undefined);

  useEffect(() => {
    track(AnalyticsEvents.Onboarding.STEP_VIEWED, { step });
  }, [step, track]);

  return (
    <Frame
      title="Get started with TrueForge"
      stepper={<Stepper steps={STEP_LABELS} currentIndex={STEPS.indexOf(step)} />}
    >
      {step === 'model' ? (
        <ConnectModelStep
          connectedType={connectedType}
          onConnected={providerType => {
            setConnectedType(providerType);
            setStep('mcp');
          }}
        />
      ) : (
        <ConnectMcpStep
          onBack={() => setStep('model')}
          onSkip={() => {
            track(AnalyticsEvents.Onboarding.SKIPPED, { step });
            onComplete();
          }}
          onDone={() => {
            track(AnalyticsEvents.Onboarding.COMPLETED, { step });
            onComplete();
          }}
        />
      )}
    </Frame>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    Onboarding: typeof OnboardingContainer;
  }
}
