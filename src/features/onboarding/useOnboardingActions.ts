import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { OnboardingActions } from './onboardingConstants';
import { markDemoTourDone } from './onboardingConstants';

export interface OnboardingState {
  navigate: ReturnType<typeof useNavigate>;
  displayedStep: number;
  transitioning: boolean;
  handleSkipSetup: () => void;
}

export function useOnboardingActions(props: OnboardingActions): OnboardingState {
  const { step, complete, demoMode } = props;
  const navigate = useNavigate();

  const [displayedStep, setDisplayedStep] = useState(step);
  const transitioning = step !== displayedStep;

  useEffect(() => {
    if (step === displayedStep) return;
    const timer = setTimeout(() => setDisplayedStep(step), 200);
    return () => clearTimeout(timer);
  }, [step, displayedStep]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  function handleSkipSetup() {
    if (demoMode) markDemoTourDone();
    complete();
  }

  return {
    navigate,
    displayedStep,
    transitioning,
    handleSkipSetup,
  };
}
